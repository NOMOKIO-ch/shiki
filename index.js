import dotenv from "dotenv";
dotenv.config();

import fs from "fs";
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
} from "discord.js";
import express from "express";
import cors from "cors";

// 🌐 Express
const app = express();
app.use(cors());
app.use(express.json());

// 🤖 Discord Client
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// 📂 Config File
const CONFIG_FILE = "./config.json";
const DEFAULT_URL = "https://roleplayfrom.vercel.app/";

let config = fs.existsSync(CONFIG_FILE)
  ? JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"))
  : {
      privateChannel: null,
      roleToGive: null,
      embedImage: null,
      embedColor: "#FFD700",
    };

function saveConfig() {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// 🎯 เมื่อบอทออนไลน์
client.once("ready", () => {
  console.log(`✅ บอทออนไลน์แล้วในชื่อ ${client.user.tag}`);
});

// 🧩 ลงทะเบียนคำสั่ง
const commands = [
  new SlashCommandBuilder()
    .setName("set")
    .setDescription("ตั้งค่าช่องหรือข้อความ")
    .addSubcommand((sub) =>
      sub
        .setName("private-channel")
        .setDescription("ตั้งค่าช่องสำหรับสรุปข้อมูลจากฟอร์ม")
        .addChannelOption((opt) =>
          opt.setName("channel").setDescription("ช่องสำหรับสรุป").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("message")
        .setDescription("ตั้งค่าข้อความประกาศพร้อมปุ่มฟอร์ม")
        .addChannelOption((opt) =>
          opt.setName("channel").setDescription("ช่องที่จะประกาศ").setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName("message").setDescription("ข้อความประกาศ").setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName("url").setDescription("ลิงก์ฟอร์ม (ถ้าไม่ใส่จะใช้ค่า default)")
        )
        .addStringOption((opt) =>
          opt.setName("image").setDescription("ลิงก์รูปหรือ GIF ตกแต่ง embed")
        )
        .addStringOption((opt) =>
          opt.setName("color").setDescription("สี embed (เช่น #ff0000)")
        )
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("setrole")
    .setDescription("ตั้งค่ายศที่จะให้เมื่อมีคนกรอกฟอร์ม")
    .addRoleOption((opt) =>
      opt.setName("role").setDescription("เลือกยศที่จะให้").setRequired(true)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("clearconfig")
    .setDescription("ล้างค่าการตั้งค่าทั้งหมด")
    .toJSON(),
];

// 📦 ลงทะเบียนคำสั่งกับ Discord
const rest = new REST({ version: "10" }).setToken(process.env.BOT_TOKEN);
(async () => {
  try {
    console.log("🔄 กำลังลงทะเบียนคำสั่ง...");
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    console.log("✅ ลงทะเบียนคำสั่งแล้ว!");
  } catch (err) {
    console.error(err);
  }
})();

// 🎮 การทำงานของคำสั่ง
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, options } = interaction;

  // ✳️ /set private-channel
  if (commandName === "set" && options.getSubcommand() === "private-channel") {
    const channel = options.getChannel("channel");
    config.privateChannel = channel.id;
    saveConfig();

    await interaction.reply({
      content: `✅ ตั้งค่าช่องสรุปข้อมูลเป็น ${channel}`,
      ephemeral: true,
    });
  }

  // ✳️ /set message
  if (commandName === "set" && options.getSubcommand() === "message") {
    const channel = options.getChannel("channel");
    const messageText = options.getString("message");
    const formUrl = options.getString("url") || DEFAULT_URL;
    const imageUrl = options.getString("image");
    const color = options.getString("color") || "#FFD700";

    const embed = new EmbedBuilder()
      .setTitle("📋 ลงทะเบียนตัวละคร")
      .setDescription(messageText)
      .setColor(color);

    if (imageUrl) embed.setImage(imageUrl);

    const button = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel("🔗 กรอกฟอร์มที่นี่")
        .setStyle(ButtonStyle.Link)
        .setURL(formUrl)
    );

    await channel.send({ embeds: [embed], components: [button] });

    config.embedImage = imageUrl;
    config.embedColor = color;
    saveConfig();

    await interaction.reply({
      content: `✅ ส่งข้อความประกาศเรียบร้อยที่ ${channel}`,
      ephemeral: true,
    });
  }

  // ✳️ /setrole
  if (commandName === "setrole") {
    const role = options.getRole("role");
    config.roleToGive = role.id;
    saveConfig();

    await interaction.reply({
      content: `✅ ตั้งค่ายศที่จะให้เป็น: ${role.name}`,
      ephemeral: true,
    });
  }

  // ✳️ /clearconfig
  if (commandName === "clearconfig") {
    config = { privateChannel: null, roleToGive: null, embedImage: null, embedColor: "#FFD700" };
    saveConfig();

    await interaction.reply({
      content: "🧹 ล้างค่าการตั้งค่าทั้งหมดเรียบร้อย!",
      ephemeral: true,
    });
  }
});

// 🌐 รับข้อมูลจากฟอร์ม
app.post("/submit", async (req, res) => {
  try {
    const data = req.body;
    if (!config.privateChannel) return res.status(400).send("ยังไม่ได้ตั้งค่าช่องสรุป!");

    const channel = await client.channels.fetch(config.privateChannel);
    if (!channel) return res.status(404).send("ไม่พบช่อง!");

    const embed = new EmbedBuilder()
      .setTitle("📝 ข้อมูลการลงทะเบียนตัวละครใหม่")
      .setColor(config.embedColor || "#A020F0")
      .addFields(
        { name: "ชื่อ OC", value: data.oc_name || "ไม่ระบุ", inline: true },
        { name: "อายุ OC", value: data.oc_age || "ไม่ระบุ", inline: true },
        { name: "ชื่อ IC", value: data.ic_name || "ไม่ระบุ", inline: true },
        { name: "อายุ IC", value: data.ic_age || "ไม่ระบุ", inline: true },
        { name: "ส่วนสูง IC", value: data.ic_height || "ไม่ระบุ", inline: true },
        { name: "สายพันธุ์", value: data.species || "ไม่ระบุ", inline: true },
        { name: "Discord", value: data.discord_user || "ไม่ระบุ", inline: true },
        { name: "ประวัติ IC", value: data.ic_history || "ไม่ระบุ" }
      )
      .setTimestamp();

    if (config.embedImage) embed.setImage(config.embedImage);

    await channel.send({ embeds: [embed] });

    // ✅ ให้ยศอัตโนมัติถ้ามีตั้งค่าไว้
    if (config.roleToGive && data.discord_user) {
      const guild = channel.guild;
      const member = guild.members.cache.find((m) =>
        m.user.tag.toLowerCase() === data.discord_user.toLowerCase()
      );

      if (member) {
        await member.roles.add(config.roleToGive).catch(() => null);
        console.log(`🎖️ ให้ยศ ${config.roleToGive} แก่ ${member.user.tag}`);
      }
    }

    res.send({ status: "ok" });
  } catch (err) {
    console.error(err);
    res.status(500).send({ status: "error" });
  }
});

app.listen(3000, () => console.log("🌐 Web API รันที่พอร์ต 3000"));
