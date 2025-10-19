import dotenv from "dotenv";
dotenv.config();

import fs from "fs";
import path from "path";
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
} from "discord.js";
import express from "express";
import cors from "cors";

const app = express();
app.use(express.json());

// 🧩 ตรวจสอบว่าอยู่ใน Local หรือ Cloud
const isLocal = !process.env.KOYEB_APP_ID && !process.env.RENDER;

// 📁 อ่าน .gitignore เฉพาะตอน Local
let ignoredFiles = [];
if (isLocal) {
  const gitignorePath = path.join(process.cwd(), ".gitignore");
  if (fs.existsSync(gitignorePath)) {
    ignoredFiles = fs
      .readFileSync(gitignorePath, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
    console.log("📄 โหลดรายการ .gitignore แล้ว:", ignoredFiles);
  }
}

// ✅ CORS
const allowedOrigins = [
  "https://roleplayfrom.vercel.app",
  "https://www.roleplayfrom.vercel.app",
];
if (isLocal) allowedOrigins.push("http://localhost:10000", "http://127.0.0.1:10000");

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) callback(null, true);
      else callback(new Error("❌ Origin ไม่ได้รับอนุญาต"));
    },
    methods: ["POST", "GET"],
  })
);

// 🧠 Discord Client
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

// 📦 Config
const CONFIG_FILE = "./config.json";
let config = {};
if (!ignoredFiles.includes("config.json")) {
  config = fs.existsSync(CONFIG_FILE) ? JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) : {};
} else {
  console.log("⚠️ ข้ามไฟล์ config.json (อยู่ใน .gitignore)");
}

function saveConfig() {
  if (!ignoredFiles.includes("config.json")) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  }
}

// 🟢 เมื่อบอทออนไลน์
client.once("ready", () => {
  console.log(`✅ บอทออนไลน์แล้วในชื่อ ${client.user.tag}`);
});

// 🔑 Login
client
  .login(process.env.BOT_TOKEN)
  .then(() => console.log("✅ Login สำเร็จ"))
  .catch((err) => console.error("❌ Login ไม่สำเร็จ:", err));

// 🧩 คำสั่ง Slash
const commands = [
  new SlashCommandBuilder()
    .setName("setchannel")
    .setDescription("ตั้งค่าช่องสำหรับสรุปข้อมูลฟอร์ม")
    .addChannelOption((opt) =>
      opt.setName("channel").setDescription("ช่องสรุป").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("setannounce")
    .setDescription("ตั้งค่าการประกาศฟอร์มและประกาศทันที")
    .addChannelOption((opt) =>
      opt.setName("channel").setDescription("ช่องประกาศ").setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName("message").setDescription("ข้อความประกาศ").setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName("image").setDescription("ลิงก์รูป/GIF")
    )
    .addStringOption((opt) =>
      opt.setName("color").setDescription("สี embed เช่น #FFD700")
    ),

  new SlashCommandBuilder()
    .setName("setsummary")
    .setDescription("ตั้ง template สรุป เช่น {OC},{IC},{A},{IC_A},{HCM},{SPC},{DC},{STR}")
    .addStringOption((opt) =>
      opt
        .setName("message")
        .setDescription("กรอกข้อความสรุป: ใช้ {OC},{IC},{A},{IC_A},{HCM},{SPC},{DC},{STR}")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("setrole")
    .setDescription("ตั้ง role หลังกรอกฟอร์ม")
    .addRoleOption((opt) =>
      opt.setName("role").setDescription("เลือก role").setRequired(true)
    ),

  new SlashCommandBuilder().setName("preview").setDescription("ดูตัวอย่างประกาศและสรุป"),

  new SlashCommandBuilder().setName("clearsetting").setDescription("ล้างค่าการตั้งค่าของเซิร์ฟ"),
].map((cmd) => cmd.toJSON());

// 🔁 ลงทะเบียน Slash Commands
const rest = new REST({ version: "10" }).setToken(process.env.BOT_TOKEN);
(async () => {
  try {
    console.log("🔄 กำลังลงทะเบียนคำสั่ง...");
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    console.log("✅ ลงทะเบียนคำสั่งเรียบร้อย!");
  } catch (err) {
    console.error("❌ ลงทะเบียนคำสั่งล้มเหลว:", err);
  }
})();

// 📌 จัดการ Slash Command
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName, options, guildId } = interaction;

  if (!config[guildId])
    config[guildId] = {
      summaryChannel: null,
      announceChannel: null,
      announceMessage: null,
      summaryMessage: null,
      roleToGive: null,
      embedImage: null,
      embedColor: "#FFD700",
    };

  try {
    if (commandName === "setchannel") {
      const channel = options.getChannel("channel");
      config[guildId].summaryChannel = channel.id;
      saveConfig();
      return interaction.reply({ content: `✅ ตั้งค่าช่องสรุปเป็น <#${channel.id}>`, ephemeral: true });
    }

    if (commandName === "setannounce") {
      const channel = options.getChannel("channel");
      config[guildId].announceChannel = channel.id;
      config[guildId].announceMessage = options.getString("message");
      config[guildId].embedImage = options.getString("image");
      config[guildId].embedColor = options.getString("color") || "#FFD700";
      saveConfig();

      const embed = new EmbedBuilder()
        .setTitle("📢 ประกาศฟอร์ม")
        .setDescription(config[guildId].announceMessage)
        .setColor(config[guildId].embedColor);
      if (config[guildId].embedImage) embed.setImage(config[guildId].embedImage);

      const announceChannel = await client.channels.fetch(config[guildId].announceChannel).catch(() => null);
      if (announceChannel) await announceChannel.send({ embeds: [embed] });

      return interaction.reply({ content: `✅ ตั้งค่าการประกาศใน <#${channel.id}> แล้ว!`, ephemeral: true });
    }

    if (commandName === "setsummary") {
      const msg = options.getString("message");
      if (msg.length > 100) return interaction.reply({ content: "❌ ข้อความสรุปเกิน 100 ตัวอักษร!", ephemeral: true });
      config[guildId].summaryMessage = msg;
      saveConfig();
      return interaction.reply({ content: "✅ บันทึกเทมเพลตสรุปเรียบร้อย!", ephemeral: true });
    }

    if (commandName === "setrole") {
      const role = options.getRole("role");
      config[guildId].roleToGive = role.id;
      saveConfig();
      return interaction.reply({ content: `✅ ตั้ง role หลังกรอกฟอร์มเป็น: ${role.name}`, ephemeral: true });
    }

    if (commandName === "preview") {
      const g = config[guildId];
      const dummy = { OC: "Luna", IC: "Shiki", A: "17", IC_A: "25", HCM: "175cm", SPC: "Furry Fox", DC: "Shiki#1234", STR: "นักผจญภัย" };

      const announceEmbed = new EmbedBuilder()
        .setTitle("📢 ตัวอย่างประกาศ")
        .setDescription(g.announceMessage || "กรอกฟอร์มเพื่อสมัครตัวละคร")
        .setColor(g.embedColor);
      if (g.embedImage) announceEmbed.setImage(g.embedImage);
      await interaction.reply({ embeds: [announceEmbed], ephemeral: true });

      if (g.summaryMessage) {
        const summaryEmbed = new EmbedBuilder().setTitle("📝 ตัวอย่างสรุป").setColor(g.embedColor);
        const fields = g.summaryMessage.match(/\{(.*?)\}/g);
        fields?.forEach((f) => {
          const key = f.replace(/[{}]/g, "");
          summaryEmbed.addFields({ name: key, value: dummy[key.toUpperCase()] || "ไม่ระบุ", inline: true });
        });
        await interaction.followUp({ embeds: [summaryEmbed], ephemeral: true });
      }
    }

    if (commandName === "clearsetting") {
      config[guildId] = { summaryChannel: null, announceChannel: null, announceMessage: null, summaryMessage: null, roleToGive: null, embedImage: null, embedColor: "#FFD700" };
      saveConfig();
      return interaction.reply({ content: "🧹 ล้างค่าการตั้งค่าของเซิร์ฟเรียบร้อย!", ephemeral: true });
    }
  } catch (err) {
    console.error(err);
    interaction.reply({ content: "❌ เกิดข้อผิดพลาด!", ephemeral: true });
  }
});

// 📨 รับข้อมูลจากเว็บฟอร์ม
app.post("/submit", async (req, res) => {
  try {
    const data = req.body;
    const targetGuildId = data.guild_id;
    if (!targetGuildId || !config[targetGuildId]) return res.status(400).send("❌ ไม่พบเซิร์ฟเวอร์");

    const guildConfig = config[targetGuildId];
    const channel = await client.channels.fetch(guildConfig.summaryChannel).catch(() => null);
    if (!channel) return res.status(404).send("❌ ไม่พบช่องสำหรับสรุป");

    const embed = new EmbedBuilder().setTitle("📝 ข้อมูลใหม่").setColor(guildConfig.embedColor);
    const fields = guildConfig.summaryMessage?.match(/\{(.*?)\}/g);
    fields?.forEach((f) => {
      const key = f.replace(/[{}]/g, "");
      embed.addFields({ name: key, value: data[key.toLowerCase()] || "ไม่ระบุ", inline: true });
    });
    if (guildConfig.embedImage) embed.setImage(guildConfig.embedImage);

    await channel.send({ embeds: [embed] });

    // 🎖️ มอบ Role
    if (guildConfig.roleToGive && data.discord_id) {
      const guild = await client.guilds.fetch(targetGuildId);
      const member = await guild.members.fetch(data.discord_id).catch(() => null);
      if (member) {
        const role = guild.roles.cache.get(guildConfig.roleToGive);
        if (role && !member.roles.cache.has(role.id)) await member.roles.add(role);
      }
    }

    res.send({ status: "ok" });
  } catch (err) {
    console.error(err);
    res.status(500).send({ status: "error", error: err.message });
  }
});

// 🌐 รันเซิร์ฟเวอร์
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🌐 Web API รันที่พอร์ต ${PORT} | โหมด: ${isLocal ? "Local" : "Cloud"}`));
