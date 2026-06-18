import dotenv from "dotenv";
dotenv.config({ quiet: true });

import fs from "fs";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  ModalBuilder,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";
import express from "express";
import cors from "cors";
import { cert, getApps, initializeApp as initializeFirebaseAdmin } from "firebase-admin/app";
import { getDatabase as getAdminDatabase } from "firebase-admin/database";

const CONFIG_FILE = "./config.json";
const MAX_FORM_FIELDS = 20;
const DEFAULT_COLOR = "#00D1FF";
const FORM_BASE_URL = (process.env.FORM_BASE_URL || "https://roleplayfrom.vercel.app").replace(/\/$/, "");
const DEFAULT_FIREBASE_DATABASE_URL = "https://namez-base-default-rtdb.firebaseio.com";
const SERVICE_ACCOUNT_BASE64_ENV = stripWrappingQuotes(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 || "");
const MISPLACED_DATABASE_URL =
  isUrl(SERVICE_ACCOUNT_BASE64_ENV) && /firebaseio\.com\/?$/i.test(SERVICE_ACCOUNT_BASE64_ENV)
    ? SERVICE_ACCOUNT_BASE64_ENV
    : "";
const FIREBASE_DATABASE_URL =
  (process.env.FIREBASE_DATABASE_URL || MISPLACED_DATABASE_URL || DEFAULT_FIREBASE_DATABASE_URL).replace(/\/$/, "");
const PORT = Number(process.env.PORT || 10000);

const summaryTemplateAll = () =>
  [
    "Applicant: {user_mb}",
    "Submitted: {timing}",
    "",
    "{answers}"
  ].join("\n");

const EMBED_TARGETS = ["form", "summary", "welcome", "goodbye"];
const MEMBER_EMBED_TARGETS = new Set(["welcome", "goodbye"]);

const formOrigin = (() => {
  try {
    return new URL(FORM_BASE_URL).origin;
  } catch {
    return "";
  }
})();

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(
  cors({
    origin: (origin, callback) => {
      if (
        !origin ||
        origin === formOrigin ||
        origin.startsWith("http://localhost:") ||
        origin.startsWith("http://127.0.0.1:")
      ) {
        callback(null, true);
        return;
      }

      callback(new Error("Origin is not allowed"));
    },
    methods: ["GET", "POST"]
  })
);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

let config = loadConfig();
let firebaseDb = null;
const watchedProjects = new Set();
const projectCache = new Map();

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return {};

  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    console.error("Failed to read config.json:", error);
    return {};
  }
}

function saveConfig() {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function defaultGuildConfig() {
  return {
    projectId: null,
    roleToGive: null,
    summary: {
      channelId: null,
      title: "New form submission",
      template: summaryTemplateAll(),
      color: DEFAULT_COLOR,
      image: "",
      thumbnail: "",
      footer: "Visual summary from Love Form Studio"
    },
    formAnnounce: {
      channelId: null,
      title: "Application Form",
      description: "Open the form below and submit your application.",
      color: DEFAULT_COLOR,
      image: "",
      thumbnail: "",
      footer: "",
      buttonLabel: "Open form"
    },
    welcome: {
      enabled: false,
      channelId: null,
      title: "Welcome {user}",
      description: "Welcome to {server}, {user}.",
      color: "#00D1FF",
      image: "",
      thumbnail: "{user_avatar}",
      footer: "User ID: {user_id} | {time}"
    },
    goodbye: {
      enabled: false,
      channelId: null,
      title: "Goodbye {user}",
      description: "{user} left {server}.",
      color: "#FF6370",
      image: "",
      thumbnail: "{user_avatar}",
      footer: "User ID: {user_id} | {time}"
    }
  };
}

function cleanString(value, max = 1000) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizeProjectIdInput(value) {
  const text = stripWrappingQuotes(cleanString(value, 1000)).replace(/^<|>$/g, "").trim();
  if (!text) throw new Error("Project ID is required.");

  let projectId = text;
  const queryMatch = text.match(/[?&]project=([^&#\s]+)/i);
  if (queryMatch) {
    projectId = decodeURIComponent(queryMatch[1]);
  } else {
    try {
      const url = new URL(text);
      projectId = url.searchParams.get("project") || url.searchParams.get("project_id") || "";
    } catch {
      projectId = text;
    }
  }

  projectId = stripWrappingQuotes(projectId).trim();
  if (!projectId) throw new Error("Project URL does not contain a project query value.");
  if (projectId.length > 160) throw new Error("Project ID is too long.");
  if (/[.#$\[\]/]/.test(projectId) || /[\x00-\x1f\x7f]/.test(projectId)) {
    throw new Error("Project ID contains invalid Firebase path characters. Paste only the value after ?project=.");
  }

  return projectId;
}

function normalizeStoredProjectId(value) {
  if (!value) return null;
  try {
    return normalizeProjectIdInput(value);
  } catch {
    return null;
  }
}

function isUrl(value) {
  return /^https?:\/\/\S+$/i.test(String(value || "").trim());
}

function safeColor(value, fallback = DEFAULT_COLOR) {
  const color = cleanString(value, 24);
  return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

function isHttpUrl(value) {
  return /^https?:\/\/\S+$/i.test(cleanString(value, 700));
}

function isSnowflake(value) {
  return /^\d{17,20}$/.test(cleanString(value, 32));
}

function extractSnowflake(value) {
  const match = cleanString(value, 80).match(/\d{17,20}/);
  return match?.[0] || "";
}

function mergeEmbedSection(defaults, raw = {}, legacy = {}) {
  return {
    channelId: cleanString(raw.channelId || legacy.channelId || defaults.channelId, 32) || null,
    title: cleanString(raw.title || legacy.title || defaults.title, 256),
    description: cleanString(raw.description || legacy.description || defaults.description || "", 4000),
    template: cleanString(raw.template || legacy.template || defaults.template || "", 4000),
    color: safeColor(raw.color || legacy.color, defaults.color),
    image: cleanString(raw.image || legacy.image || defaults.image || "", 700),
    thumbnail: cleanString(raw.thumbnail || legacy.thumbnail || defaults.thumbnail || "", 700),
    footer: cleanString(raw.footer || legacy.footer || defaults.footer || "", 2048),
    buttonLabel: cleanString(raw.buttonLabel || legacy.buttonLabel || defaults.buttonLabel || "Open", 80),
    enabled: raw.enabled === undefined ? Boolean(defaults.enabled) : Boolean(raw.enabled)
  };
}

function normalizeGuildConfig(raw = {}) {
  const defaults = defaultGuildConfig();

  return {
    projectId: normalizeStoredProjectId(raw.projectId),
    roleToGive: cleanString(raw.roleToGive || "", 32) || null,
    summary: mergeEmbedSection(defaults.summary, raw.summary, {
      channelId: raw.summaryChannel,
      title: "New form submission",
      template: raw.summaryMessage,
      color: raw.embedColor,
      image: raw.embedImage
    }),
    formAnnounce: mergeEmbedSection(defaults.formAnnounce, raw.formAnnounce || raw.announce, {
      channelId: raw.announceChannel,
      description: raw.announceMessage,
      color: raw.embedColor,
      image: raw.embedImage
    }),
    welcome: mergeEmbedSection(defaults.welcome, raw.welcome),
    goodbye: mergeEmbedSection(defaults.goodbye, raw.goodbye)
  };
}

function ensureGuildConfig(guildId) {
  if (!guildId) throw new Error("This command must be used inside a server.");
  config[guildId] = normalizeGuildConfig(config[guildId]);
  return config[guildId];
}

function getFormUrl(projectId) {
  return projectId ? `${FORM_BASE_URL}/form.html?project=${encodeURIComponent(projectId)}` : FORM_BASE_URL;
}

function discordTime(timestamp = Date.now()) {
  return `<t:${Math.floor(Number(timestamp || Date.now()) / 1000)}:F>`;
}

function replaceTokens(text, replacements) {
  return cleanString(text, 4000).replace(/\{[^}]+\}/g, (token) => replacements[token] ?? token);
}

function memberReplacements(member) {
  const avatar = member.displayAvatarURL({ size: 512 });
  return {
    "{user}": `<@${member.id}>`,
    "{time}": discordTime(),
    "{user_avatar}": avatar,
    "{user_id}": member.id,
    "{server}": member.guild?.name || "this server"
  };
}

async function interactionGuildMember(interaction) {
  if (interaction.member?.displayAvatarURL) return interaction.member;
  const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
  if (member) return member;
  throw new Error("Could not load the command user as a guild member.");
}

function setOptionalImage(embed, setter, value) {
  const url = cleanString(value, 700);
  if (isHttpUrl(url)) setter.call(embed, url);
}

function buildEmbed(section, replacements = {}, fallbackDescription = "") {
  const embed = new EmbedBuilder().setColor(safeColor(section.color)).setTimestamp();
  const title = replaceTokens(section.title, replacements).slice(0, 256);
  const descriptionSource = section.description || section.template || fallbackDescription;
  const description = replaceTokens(descriptionSource, replacements).slice(0, 4000);
  const footer = replaceTokens(section.footer, replacements).slice(0, 2048);
  const image = replaceTokens(section.image, replacements);
  const thumbnail = replaceTokens(section.thumbnail, replacements);

  if (title) embed.setTitle(title);
  if (description) embed.setDescription(description);
  if (footer) embed.setFooter({ text: footer });
  setOptionalImage(embed, embed.setImage, image);
  setOptionalImage(embed, embed.setThumbnail, thumbnail);

  return embed;
}

function sectionForTarget(guildConfig, target) {
  if (target === "form") return guildConfig.formAnnounce;
  if (target === "summary") return guildConfig.summary;
  if (target === "welcome") return guildConfig.welcome;
  if (target === "goodbye") return guildConfig.goodbye;
  throw new Error("Unknown embed target.");
}

function presetForTarget(target, style) {
  const colors = {
    mimu: "#FF8AC8",
    neon: "#00D1FF",
    clean: "#7DD3FC",
    simple: "#B8C1EC"
  };
  const color = colors[style] || DEFAULT_COLOR;
  const common = {
    color,
    image: "",
    thumbnail: target === "welcome" || target === "goodbye" ? "{user_avatar}" : "",
    footer: style === "mimu" ? "{server} | {time}" : "{time}"
  };

  if (target === "welcome") {
    return {
      ...common,
      enabled: true,
      title: style === "simple" ? "Welcome" : "Welcome {user}",
      description:
        style === "neon"
          ? "**{user} joined {server}**\nUser ID: `{user_id}`"
          : "Welcome to **{server}**, {user}.",
      footer: "User ID: {user_id} | {time}"
    };
  }

  if (target === "goodbye") {
    return {
      ...common,
      enabled: true,
      title: style === "simple" ? "Goodbye" : "Goodbye {user}",
      description:
        style === "neon"
          ? "**{user} left {server}**\nUser ID: `{user_id}`"
          : "{user} left **{server}**.",
      footer: "User ID: {user_id} | {time}"
    };
  }

  if (target === "form") {
    return {
      ...common,
      title: style === "simple" ? "Application Form" : "Application Form - {time}",
      description:
        style === "mimu"
          ? "กดปุ่มด้านล่างเพื่อกรอกฟอร์ม\n\n{form_url}"
          : "Open the form below and submit your application.",
      buttonLabel: style === "simple" ? "Open" : "Open form",
      footer: "Love Form Studio | {time}"
    };
  }

  return {
    ...common,
    title: style === "simple" ? "New submission" : "New form submission",
    template:
      style === "clean"
        ? "Applicant: {user_mb}\nSubmitted: {timing}\n\n{answers_named}"
        : summaryTemplateAll(),
    footer: "Love Form Studio"
  };
}

function applyEmbedPreset(guildConfig, target, style, channelId = null) {
  const section = sectionForTarget(guildConfig, target);
  Object.assign(section, presetForTarget(target, style));
  if (channelId) section.channelId = channelId;
  return section;
}

function placeholdersForTarget(target) {
  if (target === "summary") return "{answers}, {answers_named}, {1} through {20}, {user_mb}, {timing}";
  if (target === "form") return "{form_url}, {time}";
  return "{user}, {time}, {user_avatar}, {user_id}, {server}";
}

function assertEmbedTarget(target) {
  if (!EMBED_TARGETS.includes(target)) throw new Error("Unknown embed target.");
  return target;
}

function assertManageGuild(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    throw new Error("You need Manage Server permission to edit bot embeds.");
  }
}

function validateHexColorInput(value, fallback) {
  const color = cleanString(value, 24);
  if (!color) return fallback;
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error("Hex color must look like #00D1FF.");
  return color.toUpperCase();
}

function parseEnabledInput(value, fallback) {
  const text = cleanString(value, 24).toLowerCase();
  if (!text) return fallback;
  if (["true", "on", "yes", "enable", "enabled", "1"].includes(text)) return true;
  if (["false", "off", "no", "disable", "disabled", "0"].includes(text)) return false;
  throw new Error("Enabled must be true/false, on/off, yes/no, or 1/0.");
}

function textInput(id, label, value, style = TextInputStyle.Short, maxLength = 1000, placeholder = "") {
  const input = new TextInputBuilder()
    .setCustomId(id)
    .setLabel(label)
    .setStyle(style)
    .setRequired(false)
    .setMaxLength(maxLength);

  const currentValue = cleanString(value, maxLength);
  if (currentValue) input.setValue(currentValue);
  if (placeholder) input.setPlaceholder(placeholder.slice(0, 100));
  return input;
}

function modalRow(input) {
  return new ActionRowBuilder().addComponents(input);
}

function buildEmbedEditorModal(target, panel, section) {
  assertEmbedTarget(target);
  const modal = new ModalBuilder()
    .setCustomId(`embedmodal:${target}:${panel}`)
    .setTitle(`Edit ${target}: ${panel}`);

  if (panel === "basic") {
    modal.addComponents(
      modalRow(textInput("title", "Title", section.title, TextInputStyle.Short, 256, "Embed title")),
      modalRow(textInput("color", "Hex Color", section.color, TextInputStyle.Short, 24, "#00D1FF"))
    );

    if (target === "form") {
      modal.addComponents(
        modalRow(textInput("button_label", "Button Label", section.buttonLabel, TextInputStyle.Short, 80, "Open form"))
      );
    }

    return modal;
  }

  if (panel === "body") {
    const body = target === "summary" ? section.description || section.template : section.description;
    modal.addComponents(
      modalRow(
        textInput(
          "body",
          target === "summary" ? "Summary Template" : "Description",
          body,
          TextInputStyle.Paragraph,
          4000,
          placeholdersForTarget(target)
        )
      )
    );
    return modal;
  }

  if (panel === "images") {
    modal.addComponents(
      modalRow(textInput("image", "Image URL", section.image, TextInputStyle.Short, 700, "https://...")),
      modalRow(textInput("thumbnail", "Thumbnail URL", section.thumbnail, TextInputStyle.Short, 700, "{user_avatar}"))
    );
    return modal;
  }

  if (panel === "footer") {
    modal.addComponents(
      modalRow(textInput("footer", "Footer", section.footer, TextInputStyle.Paragraph, 2048, placeholdersForTarget(target)))
    );
    return modal;
  }

  if (panel === "target") {
    modal.addComponents(
      modalRow(textInput("channel_id", "Channel ID", section.channelId || "", TextInputStyle.Short, 32, "Paste channel ID"))
    );

    if (MEMBER_EMBED_TARGETS.has(target)) {
      modal.addComponents(
        modalRow(textInput("enabled", "Enabled", section.enabled ? "true" : "false", TextInputStyle.Short, 24, "true / false"))
      );
    }

    return modal;
  }

  throw new Error("Unknown editor panel.");
}

function editorButton(target, panel, label, style = ButtonStyle.Secondary) {
  return new ButtonBuilder()
    .setCustomId(`embededit:${target}:${panel}`)
    .setLabel(label)
    .setStyle(style);
}

function embedEditorRows(target, section) {
  const rows = [
    new ActionRowBuilder().addComponents(
      editorButton(target, "basic", "Basic", ButtonStyle.Primary),
      editorButton(target, "body", "Body"),
      editorButton(target, "images", "Images"),
      editorButton(target, "footer", "Footer"),
      editorButton(target, "target", "Target")
    )
  ];

  const secondRow = new ActionRowBuilder().addComponents(
    editorButton(target, "refresh", "Refresh", ButtonStyle.Secondary)
  );

  if (MEMBER_EMBED_TARGETS.has(target)) {
    secondRow.addComponents(
      editorButton(target, "toggle", section.enabled ? "Disable" : "Enable", section.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
    );
  }

  rows.push(secondRow);
  return rows;
}

async function embedEditorPayload(target, guildConfig, interaction, notice = "") {
  assertEmbedTarget(target);
  const section = sectionForTarget(guildConfig, target);
  const preview = await previewPayloadForTarget(target, guildConfig, interaction);
  const targetChannel = section.channelId ? `<#${section.channelId}>` : "Not set";
  const enabledText = MEMBER_EMBED_TARGETS.has(target) ? (section.enabled ? "Enabled" : "Disabled") : "Always available";
  const status = new EmbedBuilder()
    .setTitle(`Editing: ${target}`)
    .setColor(safeColor(section.color))
    .setDescription(`Use the buttons below to edit this embed with popup forms.\nPlaceholders: ${placeholdersForTarget(target)}`)
    .addFields(
      { name: "Target channel", value: targetChannel, inline: true },
      { name: "Status", value: enabledText, inline: true },
      { name: "Color", value: safeColor(section.color), inline: true }
    );

  return {
    content: notice || `Editing \`${target}\` embed.`,
    embeds: [status, ...(preview.embeds || [])],
    components: embedEditorRows(target, section),
    ephemeral: true
  };
}

function stripEphemeral(payload) {
  const next = { ...payload };
  delete next.ephemeral;
  return next;
}

function stripWrappingQuotes(value) {
  const text = String(value || "").trim();
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1).trim();
  }
  return text;
}

function decodeServiceAccountBase64(value) {
  const text = stripWrappingQuotes(value);
  if (!text) return "";
  if (text.startsWith("{")) return text;
  if (isUrl(text)) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_BASE64 contains a URL. Put that URL in FIREBASE_DATABASE_URL and put base64 service-account JSON in FIREBASE_SERVICE_ACCOUNT_BASE64."
    );
  }

  const compact = text.replace(/\s/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (!/^[a-z0-9+/=]+$/i.test(compact)) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_BASE64 contains characters that are not valid base64.");
  }

  const decoded = Buffer.from(compact, "base64").toString("utf8").trim();
  if (!decoded.startsWith("{")) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_BASE64 decoded successfully, but it is not JSON.");
  }

  return decoded;
}

function normalizeServiceAccount(jsonText) {
  const serviceAccount = JSON.parse(jsonText);
  if (!serviceAccount || typeof serviceAccount !== "object") {
    throw new Error("Service account must be a JSON object.");
  }
  if (!serviceAccount.project_id || !serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error("Service account JSON must include project_id, client_email, and private_key.");
  }
  serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
  return serviceAccount;
}

function parseFirebaseServiceAccount() {
  try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_FILE) {
      const serviceAccountPath = stripWrappingQuotes(process.env.FIREBASE_SERVICE_ACCOUNT_FILE);
      const serviceAccountJson = fs.readFileSync(serviceAccountPath, "utf8");
      return normalizeServiceAccount(serviceAccountJson);
    }

    if (MISPLACED_DATABASE_URL) {
      console.warn(
        "Firebase env warning: FIREBASE_SERVICE_ACCOUNT_BASE64 currently contains a database URL. It will be used as FIREBASE_DATABASE_URL, but the Firebase bridge still needs a real service account."
      );
    }

    if (SERVICE_ACCOUNT_BASE64_ENV && !MISPLACED_DATABASE_URL) {
      return normalizeServiceAccount(decodeServiceAccountBase64(SERVICE_ACCOUNT_BASE64_ENV));
    }

    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      return normalizeServiceAccount(stripWrappingQuotes(process.env.FIREBASE_SERVICE_ACCOUNT));
    }
  } catch (error) {
    console.error(
      "Firebase bridge disabled: service account env is invalid. Use raw JSON in FIREBASE_SERVICE_ACCOUNT or base64 JSON in FIREBASE_SERVICE_ACCOUNT_BASE64."
    );
    console.error(`Firebase service account parse detail: ${error.message}`);
  }

  return null;
}

function startFirebaseBridge() {
  const serviceAccount = parseFirebaseServiceAccount();
  if (!serviceAccount) {
    console.log(
      "Firebase bridge disabled: set FIREBASE_SERVICE_ACCOUNT_BASE64, FIREBASE_SERVICE_ACCOUNT, or FIREBASE_SERVICE_ACCOUNT_FILE in the host environment."
    );
    return;
  }

  try {
    if (!getApps().length) {
      initializeFirebaseAdmin({
        credential: cert(serviceAccount),
        databaseURL: FIREBASE_DATABASE_URL
      });
    }

    firebaseDb = getAdminDatabase();
    Object.keys(config).forEach((guildId) => {
      const guildConfig = ensureGuildConfig(guildId);
      if (guildConfig.projectId) watchProjectRecords(guildConfig.projectId);
    });

    console.log(`Firebase bridge enabled for ${watchedProjects.size} linked project(s).`);
  } catch (error) {
    console.error(`Firebase bridge disabled: ${error.message}`);
  }
}

async function getProject(projectId) {
  if (!firebaseDb || !projectId) return null;

  const cached = projectCache.get(projectId);
  if (cached && Date.now() - cached.at < 30000) return cached.value;

  const snap = await firebaseDb.ref(`projects/${projectId}`).get();
  const value = snap.val();
  projectCache.set(projectId, { at: Date.now(), value });
  return value;
}

function normalizeQuestions(form) {
  if (!Array.isArray(form)) return [];

  return form.slice(0, MAX_FORM_FIELDS).map((question, index) => ({
    id: cleanString(question?.id || `q${index + 1}`, 80),
    label: cleanString(question?.label || `Question ${index + 1}`, 120),
    type: cleanString(question?.type || "text", 32)
  }));
}

function submissionAnswers(record = {}) {
  const source = record.answers && typeof record.answers === "object" ? record.answers : record;
  const ignoredKeys = new Set([
    "answers",
    "captchaChecked",
    "challengeChecked",
    "createdAt",
    "error",
    "failedAt",
    "lockedAt",
    "lockedBy",
    "processingAt",
    "sentAt",
    "source",
    "status"
  ]);

  return Object.fromEntries(
    Object.entries(source)
      .filter(([key]) => !ignoredKeys.has(key))
      .map(([key, value]) => [cleanString(key, 80), cleanString(value, 1000)])
  );
}

function answerByQuestion(answers, question, index) {
  const candidates = [
    question?.id,
    question?.label,
    `q${index + 1}`,
    String(index + 1)
  ].filter(Boolean);

  for (const key of candidates) {
    if (answers[key] !== undefined && cleanString(answers[key])) return cleanString(answers[key], 1000);

    const lowerKey = key.toLowerCase();
    const match = Object.entries(answers).find(([answerKey]) => answerKey.toLowerCase() === lowerKey);
    if (match && cleanString(match[1])) return cleanString(match[1], 1000);
  }

  return "";
}

function findSubmitter(answers, questions) {
  const preferred = questions.find((question) =>
    question.type === "discord" || /discord|user.?id|member|dc/i.test(`${question.id} ${question.label}`)
  );

  if (preferred) {
    const value = answerByQuestion(answers, preferred, questions.indexOf(preferred));
    const snowflake = extractSnowflake(value);
    if (snowflake) return `<@${snowflake}>`;
    if (value) return value;
  }

  for (const value of Object.values(answers)) {
    const snowflake = extractSnowflake(value);
    if (snowflake) return `<@${snowflake}>`;
  }

  return "Unknown user";
}

function collapseBlankLines(text) {
  return cleanString(text, 4000)
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line, index, lines) => line.trim() || (index > 0 && index < lines.length - 1 && lines[index - 1].trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function renderSummaryTemplate(template, replacements, missingAnswerTokens) {
  const lines = cleanString(template, 4000)
    .split(/\r?\n/)
    .filter((line) => !missingAnswerTokens.some((token) => line.includes(token)));

  return collapseBlankLines(lines.join("\n").replace(/\{[^}]+\}/g, (token) => replacements[token] ?? token));
}

function summaryContext(record, questions) {
  const answers = submissionAnswers(record);
  const fallbackQuestions = questions.length
    ? questions
    : Object.keys(answers).slice(0, MAX_FORM_FIELDS).map((key, index) => ({
        id: key,
        label: key || `Question ${index + 1}`,
        type: "text"
      }));

  const replacements = {
    "{user_mb}": findSubmitter(answers, fallbackQuestions),
    "{timing}": discordTime(record.createdAt || Date.now()),
    "{time}": discordTime(record.createdAt || Date.now())
  };

  const answerItems = [];
  const missingAnswerTokens = [];

  fallbackQuestions.slice(0, MAX_FORM_FIELDS).forEach((question, index) => {
    const value = answerByQuestion(answers, question, index);
    replacements[`{${index + 1}}`] = value;
    if (!value) {
      missingAnswerTokens.push(`{${index + 1}}`);
      return;
    }

    answerItems.push({
      number: index + 1,
      label: question.label,
      value
    });
  });

  for (let index = fallbackQuestions.length; index < MAX_FORM_FIELDS; index += 1) {
    replacements[`{${index + 1}}`] = "";
    missingAnswerTokens.push(`{${index + 1}}`);
  }

  replacements["{answers}"] = answerItems.map((item) => `${item.number}. ${item.value}`).join("\n");
  replacements["{answers_named}"] = answerItems
    .map((item) => `**${item.number}. ${item.label}**\n${item.value}`)
    .join("\n\n");

  const fields = answerItems.map((item) => ({
    name: `${item.number}. ${item.label}`.slice(0, 256),
    value: item.value.slice(0, 1024),
    inline: false
  }));

  return { replacements, fields, answers, missingAnswerTokens };
}

async function buildSummaryEmbed(guildConfig, projectId, record) {
  const project = await getProject(projectId);
  const questions = normalizeQuestions(project?.form);
  const context = summaryContext(record, questions);
  const hasCustomBody = Boolean(cleanString(guildConfig.summary.description || guildConfig.summary.template, 4000));
  const summarySection = { ...guildConfig.summary };
  const descriptionSource = summarySection.description || summarySection.template;
  if (descriptionSource) {
    summarySection.description = renderSummaryTemplate(
      descriptionSource,
      context.replacements,
      context.missingAnswerTokens
    );
    summarySection.template = "";
  }

  const embed = buildEmbed(summarySection, context.replacements, "New form submission");

  if (!hasCustomBody && context.fields.length) {
    embed.addFields(context.fields);
  } else if (!embed.data.description) {
    embed.setDescription("No answers were found in this submission.");
  }

  return { embed, submitter: extractSnowflake(context.replacements["{user_mb}"]) };
}

function findGuildIdByProjectId(projectId) {
  return (
    Object.entries(config).find(([, rawGuildConfig]) => normalizeGuildConfig(rawGuildConfig).projectId === projectId)?.[0] ||
    null
  );
}

async function resolveGuildForProject(projectId) {
  const configuredGuildId = findGuildIdByProjectId(projectId);
  if (configuredGuildId) return configuredGuildId;

  const project = await getProject(projectId);
  const serverId = cleanString(project?.serverId, 32);
  return config[serverId] ? serverId : null;
}

async function assertProjectBelongsToGuild(projectId, guildId) {
  if (!firebaseDb) return;

  const project = await getProject(projectId);
  const serverId = cleanString(project?.serverId, 32);
  if (serverId && serverId !== guildId) {
    throw new Error("This project Server ID does not match the current Discord server.");
  }
}

async function fetchSendableChannel(channelId) {
  if (!channelId) throw new Error("A target channel has not been configured.");

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || typeof channel.send !== "function") {
    throw new Error("The configured channel was not found or is not sendable.");
  }

  return channel;
}

async function assignRoleIfConfigured(guildId, guildConfig, memberId) {
  if (!guildConfig.roleToGive || !isSnowflake(memberId)) return;

  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return;

  const member = await guild.members.fetch(memberId).catch(() => null);
  if (!member) return;

  const role = await guild.roles.fetch(guildConfig.roleToGive).catch(() => null);
  if (role && !member.roles.cache.has(role.id)) {
    await member.roles.add(role);
  }
}

async function sendSubmissionToDiscord(guildId, record, projectId = null) {
  const guildConfig = ensureGuildConfig(guildId);
  const targetProjectId = projectId || guildConfig.projectId;
  const channel = await fetchSendableChannel(guildConfig.summary.channelId);
  const { embed, submitter } = await buildSummaryEmbed(guildConfig, targetProjectId, record);

  await channel.send({ embeds: [embed] });
  await assignRoleIfConfigured(guildId, guildConfig, submitter);
}

async function processFirebaseRecord(projectId, recordId, record) {
  if (!firebaseDb || !record || record.status !== "pending") return;

  const guildId = await resolveGuildForProject(projectId);
  if (!guildId) return;

  const recordRef = firebaseDb.ref(`projects/${projectId}/records/${recordId}`);
  const lockResult = await recordRef.transaction((current) => {
    if (!current || current.status !== "pending") return;
    return {
      ...current,
      status: "processing",
      lockedBy: client.user?.id || "bot",
      lockedAt: Date.now()
    };
  });

  if (!lockResult.committed) return;

  try {
    await sendSubmissionToDiscord(guildId, lockResult.snapshot.val(), projectId);
    await recordRef.update({ status: "sent", sentAt: Date.now() });
  } catch (error) {
    console.error("Failed to process Firebase submission:", error);
    await recordRef.update({
      status: "error",
      error: cleanString(error.message || error, 500),
      failedAt: Date.now()
    });
  }
}

function watchProjectRecords(projectId) {
  if (!firebaseDb || !projectId || watchedProjects.has(projectId)) return;

  watchedProjects.add(projectId);
  firebaseDb
    .ref(`projects/${projectId}/records`)
    .limitToLast(25)
    .on("child_added", (snap) => {
      processFirebaseRecord(projectId, snap.key, snap.val()).catch((error) =>
        console.error("Firebase listener error:", error)
      );
    });
}

async function processPendingRecordsForProject(projectId) {
  if (!firebaseDb || !projectId) return;

  const snap = await firebaseDb
    .ref(`projects/${projectId}/records`)
    .orderByChild("status")
    .equalTo("pending")
    .limitToFirst(25)
    .get();

  const jobs = [];
  snap.forEach((child) => jobs.push(processFirebaseRecord(projectId, child.key, child.val())));
  await Promise.all(jobs);
}

async function sendFormAnnouncement(guildConfig, channelId = null) {
  const channel = await fetchSendableChannel(channelId || guildConfig.formAnnounce.channelId);
  const formUrl = getFormUrl(guildConfig.projectId);
  const replacements = {
    "{form_url}": formUrl,
    "{time}": discordTime()
  };
  const embed = buildEmbed(guildConfig.formAnnounce, replacements);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel(guildConfig.formAnnounce.buttonLabel || "Open form")
      .setStyle(ButtonStyle.Link)
      .setURL(formUrl)
  );

  await channel.send({ embeds: [embed], components: [row] });
}

async function sendMemberEmbed(member, type) {
  const guildConfig = ensureGuildConfig(member.guild.id);
  const section = guildConfig[type];
  if (!section.enabled || !section.channelId) return;

  const channel = await fetchSendableChannel(section.channelId).catch(() => null);
  if (!channel) return;

  const embed = buildEmbed(section, memberReplacements(member));
  await channel.send({ embeds: [embed] });
}

function addTextOption(command, name, description, maxLength = 1000) {
  return command.addStringOption((option) =>
    option.setName(name).setDescription(description).setRequired(false).setMaxLength(maxLength)
  );
}

function addEmbedOptions(command, includeTemplate = false, includeButton = false) {
  command.addChannelOption((option) =>
    option
      .setName("channel")
      .setDescription("Text channel to send messages")
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setRequired(false)
  );
  addTextOption(command, "title", "Embed title. Supports placeholders.", 256);

  if (includeTemplate) {
    addTextOption(command, "template", "Summary body. Use {1} to {20}, {user_mb}, {timing}.", 4000);
  } else {
    addTextOption(command, "description", "Embed description. Supports placeholders.", 4000);
  }

  addTextOption(command, "color", "Embed color, for example #00D1FF.", 24);
  addTextOption(command, "image", "Embed image URL or {user_avatar}.", 700);
  addTextOption(command, "thumbnail", "Embed thumbnail URL or {user_avatar}.", 700);
  addTextOption(command, "footer", "Embed footer. Supports placeholders.", 2048);

  if (includeButton) {
    addTextOption(command, "button_label", "Form button label.", 80);
  }

  return command;
}

function buildCommands() {
  const manage = PermissionFlagsBits.ManageGuild;

  const formCommand = new SlashCommandBuilder()
    .setName("form")
    .setDescription("Configure form bridge, notifications, and form link embeds")
    .setDefaultMemberPermissions(manage)
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("project")
        .setDescription("Link this Discord server to a website project")
        .addStringOption((option) =>
          option.setName("project_id").setDescription("Project ID, public form URL, or editor URL").setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      addEmbedOptions(subcommand.setName("summary").setDescription("Configure submission summary embed"), true, false)
    )
    .addSubcommand((subcommand) =>
      addEmbedOptions(subcommand.setName("announce").setDescription("Configure the public form link embed"), false, true)
        .addBooleanOption((option) =>
          option.setName("send_now").setDescription("Send the form link embed immediately").setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("send")
        .setDescription("Send the configured public form link embed")
        .addChannelOption((option) =>
          option
            .setName("channel")
            .setDescription("Override target channel")
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("role")
        .setDescription("Set the role to give after a form submission")
        .addRoleOption((option) => option.setName("role").setDescription("Role to give").setRequired(true))
    );

  const welcomeCommand = new SlashCommandBuilder()
    .setName("welcome")
    .setDescription("Configure welcome embed")
    .setDefaultMemberPermissions(manage)
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      addEmbedOptions(subcommand.setName("setup").setDescription("Enable or edit welcome embed"), false, false)
        .addBooleanOption((option) => option.setName("enabled").setDescription("Enable welcome messages").setRequired(false))
    )
    .addSubcommand((subcommand) => subcommand.setName("test").setDescription("Preview the welcome embed"))
    .addSubcommand((subcommand) => subcommand.setName("disable").setDescription("Disable welcome messages"));

  const goodbyeCommand = new SlashCommandBuilder()
    .setName("goodbye")
    .setDescription("Configure goodbye embed")
    .setDefaultMemberPermissions(manage)
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      addEmbedOptions(subcommand.setName("setup").setDescription("Enable or edit goodbye embed"), false, false)
        .addBooleanOption((option) => option.setName("enabled").setDescription("Enable goodbye messages").setRequired(false))
    )
    .addSubcommand((subcommand) => subcommand.setName("test").setDescription("Preview the goodbye embed"))
    .addSubcommand((subcommand) => subcommand.setName("disable").setDescription("Disable goodbye messages"));

  const embedCommand = new SlashCommandBuilder()
    .setName("embed")
    .setDescription("Apply ready-made embed presets")
    .setDefaultMemberPermissions(manage)
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("editor")
        .setDescription("Open the button and popup embed editor")
        .addStringOption((option) =>
          option
            .setName("target")
            .setDescription("Embed target")
            .setRequired(true)
            .addChoices(
              { name: "form", value: "form" },
              { name: "summary", value: "summary" },
              { name: "welcome", value: "welcome" },
              { name: "goodbye", value: "goodbye" }
            )
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("preset")
        .setDescription("Apply a clean preset to an embed target")
        .addStringOption((option) =>
          option
            .setName("target")
            .setDescription("Embed target")
            .setRequired(true)
            .addChoices(
              { name: "form", value: "form" },
              { name: "summary", value: "summary" },
              { name: "welcome", value: "welcome" },
              { name: "goodbye", value: "goodbye" }
            )
        )
        .addStringOption((option) =>
          option
            .setName("style")
            .setDescription("Preset style")
            .setRequired(true)
            .addChoices(
              { name: "mimu", value: "mimu" },
              { name: "neon", value: "neon" },
              { name: "clean", value: "clean" },
              { name: "simple", value: "simple" }
            )
        )
        .addChannelOption((option) =>
          option
            .setName("channel")
            .setDescription("Optional target channel")
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(false)
        )
        .addBooleanOption((option) =>
          option.setName("preview").setDescription("Show a private preview after saving").setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("placeholders")
        .setDescription("Show placeholders for an embed target")
        .addStringOption((option) =>
          option
            .setName("target")
            .setDescription("Embed target")
            .setRequired(true)
            .addChoices(
              { name: "form", value: "form" },
              { name: "summary", value: "summary" },
              { name: "welcome", value: "welcome" },
              { name: "goodbye", value: "goodbye" }
            )
        )
    );

  const botCommand = new SlashCommandBuilder()
    .setName("bot")
    .setDescription("View or reset bot settings")
    .setDefaultMemberPermissions(manage)
    .setDMPermission(false)
    .addSubcommand((subcommand) => subcommand.setName("settings").setDescription("Show current settings"))
    .addSubcommand((subcommand) =>
      subcommand
        .setName("reset")
        .setDescription("Reset one settings group")
        .addStringOption((option) =>
          option
            .setName("target")
            .setDescription("Settings group to reset")
            .setRequired(true)
            .addChoices(
              { name: "all", value: "all" },
              { name: "form", value: "form" },
              { name: "summary", value: "summary" },
              { name: "welcome", value: "welcome" },
              { name: "goodbye", value: "goodbye" }
            )
        )
    );

  const previewCommand = new SlashCommandBuilder()
    .setName("preview")
    .setDescription("Preview configured embeds")
    .setDefaultMemberPermissions(manage)
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName("target")
        .setDescription("Embed to preview")
        .setRequired(true)
        .addChoices(
          { name: "form", value: "form" },
          { name: "summary", value: "summary" },
          { name: "welcome", value: "welcome" },
          { name: "goodbye", value: "goodbye" }
        )
    );

  return [formCommand, welcomeCommand, goodbyeCommand, embedCommand, botCommand, previewCommand].map((command) => command.toJSON());
}

async function registerCommands() {
  if (!process.env.BOT_TOKEN || !process.env.CLIENT_ID) {
    console.warn("Slash commands were not registered because BOT_TOKEN or CLIENT_ID is missing.");
    return;
  }

  const rest = new REST({ version: "10" }).setToken(process.env.BOT_TOKEN);
  await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: buildCommands() });
  console.log("Slash commands registered.");
}

function updateSectionFromOptions(section, options, { useTemplate = false, useButton = false } = {}) {
  const channel = options.getChannel("channel");
  const title = options.getString("title");
  const description = options.getString("description");
  const template = options.getString("template");
  const color = options.getString("color");
  const image = options.getString("image");
  const thumbnail = options.getString("thumbnail");
  const footer = options.getString("footer");
  const buttonLabel = options.getString("button_label");
  const enabled = options.getBoolean("enabled");

  if (channel) section.channelId = channel.id;
  if (title !== null) section.title = cleanString(title, 256);
  if (!useTemplate && description !== null) section.description = cleanString(description, 4000);
  if (useTemplate && template !== null) section.template = cleanString(template, 4000);
  if (color !== null) section.color = safeColor(color, section.color);
  if (image !== null) section.image = cleanString(image, 700);
  if (thumbnail !== null) section.thumbnail = cleanString(thumbnail, 700);
  if (footer !== null) section.footer = cleanString(footer, 2048);
  if (useButton && buttonLabel !== null) section.buttonLabel = cleanString(buttonLabel, 80);
  if (enabled !== null) section.enabled = enabled;
}

function settingsEmbed(guildConfig) {
  return new EmbedBuilder()
    .setTitle("ShikiV4 settings")
    .setColor(DEFAULT_COLOR)
    .addFields(
      { name: "Project", value: guildConfig.projectId || "Not linked", inline: false },
      { name: "Summary channel", value: guildConfig.summary.channelId ? `<#${guildConfig.summary.channelId}>` : "Not set", inline: true },
      { name: "Form announce channel", value: guildConfig.formAnnounce.channelId ? `<#${guildConfig.formAnnounce.channelId}>` : "Not set", inline: true },
      { name: "Welcome", value: guildConfig.welcome.enabled ? `<#${guildConfig.welcome.channelId}>` : "Disabled", inline: true },
      { name: "Goodbye", value: guildConfig.goodbye.enabled ? `<#${guildConfig.goodbye.channelId}>` : "Disabled", inline: true },
      { name: "Role after form", value: guildConfig.roleToGive ? `<@&${guildConfig.roleToGive}>` : "Not set", inline: true }
    )
    .setTimestamp();
}

async function handleFormCommand(interaction, guildConfig) {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "project") {
    await interaction.deferReply({ ephemeral: true });
    const projectId = normalizeProjectIdInput(interaction.options.getString("project_id"));
    await assertProjectBelongsToGuild(projectId, interaction.guildId);
    guildConfig.projectId = projectId;
    saveConfig();
    watchProjectRecords(projectId);
    await processPendingRecordsForProject(projectId);
    await interaction.editReply(`Linked project \`${projectId}\`.\nForm URL: ${getFormUrl(projectId)}`);
    return;
  }

  if (subcommand === "summary") {
    updateSectionFromOptions(guildConfig.summary, interaction.options, { useTemplate: true });
    if (!guildConfig.summary.channelId) throw new Error("Set a summary channel with the channel option.");
    saveConfig();
    await interaction.reply({ content: `Summary embed saved. Target: <#${guildConfig.summary.channelId}>`, ephemeral: true });
    return;
  }

  if (subcommand === "announce") {
    updateSectionFromOptions(guildConfig.formAnnounce, interaction.options, { useButton: true });
    if (!guildConfig.formAnnounce.channelId) throw new Error("Set a form announce channel with the channel option.");
    saveConfig();

    if (interaction.options.getBoolean("send_now")) {
      await sendFormAnnouncement(guildConfig);
    }

    await interaction.reply({ content: `Form announcement saved. Target: <#${guildConfig.formAnnounce.channelId}>`, ephemeral: true });
    return;
  }

  if (subcommand === "send") {
    const channel = interaction.options.getChannel("channel");
    await sendFormAnnouncement(guildConfig, channel?.id || null);
    await interaction.reply({ content: "Form link embed sent.", ephemeral: true });
    return;
  }

  if (subcommand === "role") {
    const role = interaction.options.getRole("role");
    guildConfig.roleToGive = role.id;
    saveConfig();
    await interaction.reply({ content: `Role after form set to ${role}.`, ephemeral: true });
  }
}

async function handleMemberEmbedCommand(interaction, guildConfig, type) {
  const subcommand = interaction.options.getSubcommand();
  const section = guildConfig[type];

  if (subcommand === "setup") {
    updateSectionFromOptions(section, interaction.options);
    if (interaction.options.getBoolean("enabled") === null) section.enabled = true;
    if (section.enabled && !section.channelId) throw new Error(`Set a ${type} channel with the channel option.`);
    saveConfig();
    await interaction.reply({ content: `${type} embed saved. Status: ${section.enabled ? "enabled" : "disabled"}.`, ephemeral: true });
    return;
  }

  if (subcommand === "disable") {
    section.enabled = false;
    saveConfig();
    await interaction.reply({ content: `${type} messages disabled.`, ephemeral: true });
    return;
  }

  if (subcommand === "test") {
    const member = await interactionGuildMember(interaction);
    const embed = buildEmbed(section, memberReplacements(member));
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
}

async function handleBotCommand(interaction, guildConfig) {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "settings") {
    await interaction.reply({ embeds: [settingsEmbed(guildConfig)], ephemeral: true });
    return;
  }

  if (subcommand === "reset") {
    const target = interaction.options.getString("target");
    const defaults = defaultGuildConfig();

    if (target === "all") {
      config[interaction.guildId] = defaults;
    } else if (target === "form") {
      guildConfig.projectId = null;
      guildConfig.roleToGive = null;
      guildConfig.formAnnounce = defaults.formAnnounce;
    } else {
      guildConfig[target] = defaults[target];
    }

    saveConfig();
    await interaction.reply({ content: `Reset ${target} settings.`, ephemeral: true });
  }
}

async function previewPayloadForTarget(target, guildConfig, interaction) {
  if (target === "form") {
    const formUrl = getFormUrl(guildConfig.projectId);
    const embed = buildEmbed(guildConfig.formAnnounce, {
      "{form_url}": formUrl,
      "{time}": discordTime()
    });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel(guildConfig.formAnnounce.buttonLabel || "Open form")
        .setStyle(ButtonStyle.Link)
        .setURL(formUrl)
    );
    return { embeds: [embed], components: [row] };
  }

  if (target === "summary") {
    const record = {
      createdAt: Date.now(),
      answers: {
        q1: "Sample answer 1",
        q2: "Sample answer 2",
        q3: "64110"
      }
    };
    const { embed } = await buildSummaryEmbed(guildConfig, guildConfig.projectId, record);
    return { embeds: [embed] };
  }

  const member = await interactionGuildMember(interaction);
  const embed = buildEmbed(guildConfig[target], memberReplacements(member));
  return { embeds: [embed] };
}

async function handleEmbedCommand(interaction, guildConfig) {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "editor") {
    const target = assertEmbedTarget(interaction.options.getString("target"));
    const payload = await embedEditorPayload(target, guildConfig, interaction);
    await interaction.reply(payload);
    return;
  }

  if (subcommand === "placeholders") {
    const target = interaction.options.getString("target");
    await interaction.reply({
      content: `Placeholders for \`${target}\`: ${placeholdersForTarget(target)}`,
      ephemeral: true
    });
    return;
  }

  const target = interaction.options.getString("target");
  const style = interaction.options.getString("style");
  const channel = interaction.options.getChannel("channel");
  applyEmbedPreset(guildConfig, target, style, channel?.id || null);
  saveConfig();

  if (interaction.options.getBoolean("preview")) {
    const payload = await previewPayloadForTarget(target, guildConfig, interaction);
    await interaction.reply({
      content: `Applied \`${style}\` preset to \`${target}\`.`,
      ...payload,
      ephemeral: true
    });
    return;
  }

  await interaction.reply({
    content: `Applied \`${style}\` preset to \`${target}\`. Use /preview target:${target} to inspect it.`,
    ephemeral: true
  });
}

async function handlePreviewCommand(interaction, guildConfig) {
  const target = interaction.options.getString("target");
  const payload = await previewPayloadForTarget(target, guildConfig, interaction);
  await interaction.reply({ ...payload, ephemeral: true });
}

async function normalizeEditorChannelId(interaction, rawValue) {
  const text = cleanString(rawValue, 80);
  if (!text) return null;

  const channelId = extractSnowflake(text);
  if (!isSnowflake(channelId)) throw new Error("Channel ID must be a Discord channel ID or channel mention.");

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || channel.guildId !== interaction.guildId) {
    throw new Error("Channel was not found in this server.");
  }

  if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
    throw new Error("Channel must be a text or announcement channel.");
  }

  return channelId;
}

async function applyEmbedEditorModal(interaction, target, panel, section) {
  if (panel === "basic") {
    section.title = cleanString(interaction.fields.getTextInputValue("title"), 256);
    section.color = validateHexColorInput(interaction.fields.getTextInputValue("color"), section.color);
    if (target === "form") {
      section.buttonLabel = cleanString(interaction.fields.getTextInputValue("button_label"), 80) || "Open form";
    }
    return;
  }

  if (panel === "body") {
    const body = cleanString(interaction.fields.getTextInputValue("body"), 4000);
    if (target === "summary") {
      section.template = body;
      section.description = "";
    } else {
      section.description = body;
    }
    return;
  }

  if (panel === "images") {
    section.image = cleanString(interaction.fields.getTextInputValue("image"), 700);
    section.thumbnail = cleanString(interaction.fields.getTextInputValue("thumbnail"), 700);
    return;
  }

  if (panel === "footer") {
    section.footer = cleanString(interaction.fields.getTextInputValue("footer"), 2048);
    return;
  }

  if (panel === "target") {
    section.channelId = await normalizeEditorChannelId(interaction, interaction.fields.getTextInputValue("channel_id"));
    if (MEMBER_EMBED_TARGETS.has(target)) {
      section.enabled = parseEnabledInput(interaction.fields.getTextInputValue("enabled"), section.enabled);
    }
    return;
  }

  throw new Error("Unknown editor panel.");
}

async function handleEmbedEditorButton(interaction) {
  if (!interaction.customId.startsWith("embededit:")) return false;
  assertManageGuild(interaction);

  const [, rawTarget, action] = interaction.customId.split(":");
  const target = assertEmbedTarget(rawTarget);
  const guildConfig = ensureGuildConfig(interaction.guildId);
  const section = sectionForTarget(guildConfig, target);

  if (["basic", "body", "images", "footer", "target"].includes(action)) {
    await interaction.showModal(buildEmbedEditorModal(target, action, section));
    return true;
  }

  if (action === "toggle") {
    if (!MEMBER_EMBED_TARGETS.has(target)) throw new Error("Only welcome and goodbye embeds can be enabled or disabled.");
    section.enabled = !section.enabled;
    saveConfig();
    const payload = await embedEditorPayload(target, guildConfig, interaction, `${target} is now ${section.enabled ? "enabled" : "disabled"}.`);
    await interaction.update(stripEphemeral(payload));
    return true;
  }

  if (action === "refresh") {
    const payload = await embedEditorPayload(target, guildConfig, interaction, `Refreshed \`${target}\` preview.`);
    await interaction.update(stripEphemeral(payload));
    return true;
  }

  throw new Error("Unknown editor action.");
}

async function handleEmbedEditorModal(interaction) {
  if (!interaction.customId.startsWith("embedmodal:")) return false;
  assertManageGuild(interaction);

  const [, rawTarget, panel] = interaction.customId.split(":");
  const target = assertEmbedTarget(rawTarget);
  const guildConfig = ensureGuildConfig(interaction.guildId);
  const section = sectionForTarget(guildConfig, target);

  await applyEmbedEditorModal(interaction, target, panel, section);
  saveConfig();

  const payload = await embedEditorPayload(target, guildConfig, interaction, `Saved \`${panel}\` settings for \`${target}\`.`);
  await interaction.reply(payload);
  return true;
}

client.once(Events.ClientReady, () => {
  startFirebaseBridge();
  console.log(`Bot online as ${client.user.tag}`);
});

client.on("guildMemberAdd", (member) => {
  sendMemberEmbed(member, "welcome").catch((error) => console.error("Welcome embed failed:", error));
});

client.on("guildMemberRemove", (member) => {
  sendMemberEmbed(member, "goodbye").catch((error) => console.error("Goodbye embed failed:", error));
});

client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isButton()) {
      await handleEmbedEditorButton(interaction);
      return;
    }

    if (interaction.isModalSubmit()) {
      await handleEmbedEditorModal(interaction);
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const guildConfig = ensureGuildConfig(interaction.guildId);

    if (interaction.commandName === "form") {
      await handleFormCommand(interaction, guildConfig);
    } else if (interaction.commandName === "welcome") {
      await handleMemberEmbedCommand(interaction, guildConfig, "welcome");
    } else if (interaction.commandName === "goodbye") {
      await handleMemberEmbedCommand(interaction, guildConfig, "goodbye");
    } else if (interaction.commandName === "embed") {
      await handleEmbedCommand(interaction, guildConfig);
    } else if (interaction.commandName === "bot") {
      await handleBotCommand(interaction, guildConfig);
    } else if (interaction.commandName === "preview") {
      await handlePreviewCommand(interaction, guildConfig);
    }
  } catch (error) {
    console.error(error);
    const payload = {
      content: `Command failed: ${cleanString(error.message || error, 300)}`
    };

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(payload).catch(() => null);
    } else {
      await interaction.reply({ ...payload, ephemeral: true }).catch(() => null);
    }
  }
});

app.get("/", (req, res) => {
  res.send({ status: "ok", bot: client.user?.tag || "starting" });
});

app.post("/submit", async (req, res) => {
  try {
    const data = req.body || {};
    const rawProjectId = data.project_id || data.projectId || "";
    const projectId = rawProjectId ? normalizeProjectIdInput(rawProjectId) : null;
    const guildId = cleanString(data.guild_id || data.guildId || "", 32) || (projectId ? await resolveGuildForProject(projectId) : null);

    if (!guildId || !config[guildId]) {
      res.status(400).send({ status: "error", error: "Server is not configured." });
      return;
    }

    await sendSubmissionToDiscord(guildId, data, projectId);
    res.send({ status: "ok" });
  } catch (error) {
    console.error(error);
    res.status(500).send({ status: "error", error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`HTTP API listening on port ${PORT}`);
});

registerCommands().catch((error) => console.error("Slash command registration failed:", error));

if (!process.env.BOT_TOKEN) {
  console.error("BOT_TOKEN is missing.");
} else {
  client.login(process.env.BOT_TOKEN).catch((error) => console.error("Discord login failed:", error));
}
