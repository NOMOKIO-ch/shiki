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
  PermissionsBitField,
} from "discord.js";
import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

// 🔹 Discord Client
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

const CONFIG_FILE = "./config.json";
const DEFAULT_URL = "https://roleplayfrom.vercel.app/";

let config = fs.existsSync(CONFIG_FILE)
  ? JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"))
  : {};

function saveConfig() {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// 🔹 บอทออนไลน์
client.once("ready", () => {
  console.log(`✅ บอทออนไลน์แล้วในชื่อ ${client.user.tag}`);
});

// 🔹 Login
client
  .login(process.env.BOT_TOKEN)
  .then(() => console.log("✅ บอท login สำเร็จ"))
  .catch((err) => console.error("❌ บอท login ไม่สำเร็จ:", err));

// 🔹 คำสั่งทั้งหมด
const commands = [
  new SlashCommandBuilder()
    .setName("setchanel")
    .setDescription("ตั้งค่าช่องสำหรับสรุปข้อมูลฟอร์ม")
    .addChannelOption(opt =>
      opt.setName("channel").setDescription("ช่องสำหรับสรุป").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("setmessage")
    .setDescription("ตั้งข้อความประกาศพร้อมปุ่มฟอร์ม")
    .addChannelOption(opt =>
      opt.setName("channel").setDescription("ช่องที่จะประกาศ").setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName("message").setDescription("ข้อความประกาศ").setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName("url").setDescription("ลิงก์ฟอร์ม (ถ้าไม่ใส่จะใช้ default)")
    )
    .addStringOption(opt =>
      opt.setName("image").setDescription("ลิงก์รูปหรือ GIF")
    )
    .addStringOption(opt =>
      opt.setName("color").setDescription("สี embed เช่น #ff0000")
    ),

  new SlashCommandBuilder()
    .setName("setrole")
    .setDescription("ตั้ง role ที่จะให้หลังกรอกฟอร์ม")
    .addRoleOption(opt =>
      opt.setName("role")
         .setDescription("เลือก role ที่จะมอบ")
         .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("clearsetting")
    .setDescription("ล้างค่าการตั้งค่าของ server นี้"),
].map(cmd => cmd.toJSON());

// 🔹 ลงทะเบียนคำสั่ง
const rest = new REST({ version: "10" }).setToken(process.env.BOT_TOKEN);
(async () => {
  try {
    console.log("🔄 กำลังลงทะเบียนคำสั่ง...");
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    console.log("✅ ลงทะเบียนคำสั่งแล้ว!");
  } catch (err) {
    console.error("❌ ลงทะเบียนคำสั่งล้มเหลว:", err);
  }
})();

// 🔹 จัดการคำสั่ง
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName, options, guildId } = interaction;

  if (!config[guildId])
    config[guildId] = { privateChannel: null, roleToGive: null, embedImage: null, embedColor: "#FFD700" };

  try {
    // setchanel
    if (commandName === "setchanel") {
      const channel = options.getChannel("channel");
      config[guildId].privateChannel = channel.id;
      saveConfig();
      await interaction.reply({ content: `✅ ตั้งค่าช่องสรุปข้อมูลเป็น ${channel}`, ephemeral: true });
    }

    // setmessage
    if (commandName === "setmessage") {
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

      config[guildId].embedImage = imageUrl;
      config[guildId].embedColor = color;
      saveConfig();

      await interaction.reply({ content: `✅ ส่งข้อความประกาศเรียบร้อยที่ ${channel}`, ephemeral: true });
    }

    // setrole
    if (commandName === "setrole") {
      const role = options.getRole("role");
      config[guildId].roleToGive = role.id; // บันทึกเป็น ID
      saveConfig();
      await interaction.reply({ content: `✅ ตั้ง role ที่จะมอบหลังกรอกฟอร์มเป็น: ${role.name}`, ephemeral: true });
    }

    // clearsetting
    if (commandName === "clearsetting") {
      config[guildId] = { privateChannel: null, roleToGive: null, embedImage: null, embedColor: "#FFD700" };
      saveConfig();
      await interaction.reply({ content: "🧹 ล้างค่าการตั้งค่าของ server นี้เรียบร้อย!", ephemeral: true });
    }
  } catch (err) {
    console.error("❌ Error:", err);
    await interaction.reply({ content: "❌ เกิดข้อผิดพลาด!", ephemeral: true });
  }
});

// 🌐 รับข้อมูลฟอร์ม
app.post("/submit", async (req, res) => {
  try {
    const data = req.body;
    const targetGuildId = Object.keys(config)[0]; // ใช้เซิร์ฟเวอร์แรก
    if (!targetGuildId) return res.status(400).send("❌ ไม่พบเซิร์ฟเวอร์");

    const channelId = config[targetGuildId].privateChannel;
    if (!channelId) return res.status(400).send("❌ ยังไม่ได้ตั้งค่าช่องสรุป");

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return res.status(404).send("❌ ไม่พบช่องที่ตั้งไว้");

    const embed = new EmbedBuilder()
      .setTitle("📝 ข้อมูลการลงทะเบียนตัวละครใหม่")
      .setColor(config[targetGuildId].embedColor || "#A020F0")
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

    if (config[targetGuildId].embedImage) embed.setImage(config[targetGuildId].embedImage);

    await channel.send({ embeds: [embed] });

    // 🎖️ มอบ role อัตโนมัติ
    if (config[targetGuildId].roleToGive && data.discord_id) {
      const guild = await client.guilds.fetch(targetGuildId);
      await guild.members.fetch();

      const member = guild.members.cache.get(data.discord_id);
      if (member) {
        const role = guild.roles.cache.get(config[targetGuildId].roleToGive);
        if (role && !member.roles.cache.has(role.id)) {
          await member.roles.add(role);
          console.log(`🎖️ ให้ role ${role.name} แก่ ${member.user.tag}`);
        }
      }
    }

    res.send({ status: "ok" });
  } catch (err) {
    console.error("❌ Error /submit:", err);
    res.status(500).send({ status: "error", error: err.message });
  }
});

// 🌐 Start API
app.listen(3000, () => console.log("🌐 Web API รันที่พอร์ต 3000"));