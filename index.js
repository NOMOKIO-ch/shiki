import dotenv from "dotenv";
dotenv.config();

import fs from "fs"; // ✅ เพิ่มบรรทัดนี้
import { Client, GatewayIntentBits } from "discord.js";
import express from "express";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const app = express();
app.use(express.json());

const CONFIG_FILE = "./config.json";
const DEFAULT_URL = "https://roleplayfrom.vercel.app/";

let config = fs.existsSync(CONFIG_FILE)
  ? JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"))
  : { privateChannel: null };

function saveConfig() {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

client.once("ready", async () => {
  console.log(`✅ บอทออนไลน์แล้วในชื่อ ${client.user.tag}`);
});

// ลงทะเบียนคำสั่ง
const commands = [
  new SlashCommandBuilder()
    .setName("set")
    .setDescription("ตั้งค่าช่องหรือข้อความ")
    .addSubcommand(sub =>
      sub
        .setName("private-channel")
        .setDescription("ตั้งค่าช่องสำหรับสรุปข้อมูลจากฟอร์ม")
        .addChannelOption(opt =>
          opt.setName("channel").setDescription("ช่องสำหรับสรุป").setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("message")
        .setDescription("ตั้งค่าข้อความประกาศพร้อมปุ่มฟอร์ม")
        .addChannelOption(opt =>
          opt.setName("channel").setDescription("ช่องที่จะประกาศ").setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName("message").setDescription("ข้อความประกาศ").setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName("url").setDescription("ลิงก์ฟอร์ม (ถ้าไม่ใส่จะใช้ค่า default)")
        )
    ),
];

const rest = new REST({ version: "10" }).setToken(process.env.BOT_TOKEN);
(async () => {
  try {
    console.log("🔄 กำลังลงทะเบียนคำสั่ง /set...");
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    console.log("✅ ลงทะเบียนคำสั่งแล้ว!");
  } catch (err) {
    console.error(err);
  }
})();

// 🎯 การทำงานของคำสั่ง /set
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName, options } = interaction;

  if (commandName === "set") {
    const sub = interaction.options.getSubcommand();

    if (sub === "private-channel") {
      const channel = options.getChannel("channel");
      config.privateChannel = channel.id;
      saveConfig();

      await interaction.reply({
        content: `✅ ตั้งค่าช่องสรุปข้อมูลเป็น ${channel}`,
        ephemeral: true,
      });
    }

    if (sub === "message") {
      const channel = options.getChannel("channel");
      const messageText = options.getString("message");
      const formUrl = options.getString("url") || DEFAULT_URL;

      const embed = new EmbedBuilder()
        .setTitle("📋 ลงทะเบียนตัวละคร")
        .setDescription(messageText)
        .setColor("Gold");

      const button = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel("🔗 กรอกฟอร์มที่นี่")
          .setStyle(ButtonStyle.Link)
          .setURL(formUrl)
      );

      await channel.send({ embeds: [embed], components: [button] });
      await interaction.reply({
        content: `✅ ส่งข้อความประกาศเรียบร้อยที่ ${channel}`,
        ephemeral: true,
      });
    }
  }
});

client.login(process.env.BOT_TOKEN);

// 🌐 API รับข้อมูลจากฟอร์ม
app.post("/submit", async (req, res) => {
  try {
    const data = req.body;
    if (!config.privateChannel) return res.status(400).send("ยังไม่ได้ตั้งค่าช่องสรุป!");

    const channel = await client.channels.fetch(config.privateChannel);
    if (!channel) return res.status(404).send("ไม่พบช่อง!");

    const embed = new EmbedBuilder()
      .setTitle("📝 ข้อมูลการลงทะเบียนตัวละครใหม่")
      .setColor("Purple")
      .addFields(
        { name: "ชื่อ OC", value: data.oc_name },
        { name: "อายุ OC", value: data.oc_age },
        { name: "ชื่อ IC", value: data.ic_name },
        { name: "อายุ IC", value: data.ic_age },
        { name: "ส่วนสูง IC", value: data.ic_height },
        { name: "สายพันธุ์", value: data.species },
        { name: "Discord", value: data.discord_user },
        { name: "ประวัติ IC", value: data.ic_history }
      )
      .setTimestamp();

    await channel.send({ embeds: [embed] });
    res.send({ status: "ok" });
  } catch (err) {
    console.error(err);
    res.status(500).send({ status: "error" });
  }
});

app.listen(3000, () => console.log("🌐 Web API รันที่พอร์ต 3000"));
