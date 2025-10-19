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

const app = express();
app.use(express.json());

// ✅ อนุญาตเฉพาะเว็บของนายเท่านั้น
const allowedOrigin = "https://roleplayfrom.vercel.app";
app.use(cors({
  origin: allowedOrigin,
  methods: ["POST", "GET"],
}));

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

const CONFIG_FILE = "./config.json";
let config = fs.existsSync(CONFIG_FILE) ? JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) : {};

function saveConfig() {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// 🟢 เมื่อบอทออนไลน์
client.once("ready", () => {
  console.log(`✅ บอทออนไลน์แล้วในชื่อ ${client.user.tag}`);
});

client.login(process.env.BOT_TOKEN)
  .then(() => console.log("✅ Login สำเร็จ"))
  .catch(err => console.error("❌ Login ไม่สำเร็จ:", err));

// 🛠️ คำสั่ง Slash
const commands = [
  new SlashCommandBuilder()
    .setName("setchannel")
    .setDescription("ตั้งค่าช่องสำหรับสรุปข้อมูลฟอร์ม")
    .addChannelOption(opt => opt.setName("channel").setDescription("ช่องสรุป").setRequired(true)),

  new SlashCommandBuilder()
    .setName("setannounce")
    .setDescription("ตั้งค่าการประกาศฟอร์มและประกาศทันที")
    .addChannelOption(opt => opt.setName("channel").setDescription("ช่องประกาศ").setRequired(true))
    .addStringOption(opt => opt.setName("message").setDescription("ข้อความประกาศ").setRequired(true))
    .addStringOption(opt => opt.setName("image").setDescription("ลิงก์รูป/ GIF"))
    .addStringOption(opt => opt.setName("color").setDescription("สี embed เช่น #FFD700")),

  new SlashCommandBuilder()
    .setName("setsummary")
    .setDescription("ตั้ง template สรุปข้อมูลฟอร์ม (ใช้ {OC}, {IC}, {OC_AGE}, {IC_AGE}, {HEIGHT}, {SPECIES}, {DISCORD}, {HISTORY})")
    .addStringOption(opt => opt.setName("message").setDescription("ข้อความสรุป").setRequired(true)),

  new SlashCommandBuilder()
    .setName("setrole")
    .setDescription("ตั้ง role ที่มอบหลังกรอกฟอร์ม")
    .addRoleOption(opt => opt.setName("role").setDescription("เลือก role").setRequired(true)),

  new SlashCommandBuilder()
    .setName("preview")
    .setDescription("ดูตัวอย่างประกาศและสรุป"),

  new SlashCommandBuilder()
    .setName("clearsetting")
    .setDescription("ล้างค่าการตั้งค่าของเซิร์ฟ")
].map(cmd => cmd.toJSON());

// ลงทะเบียนคำสั่ง
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

// 📦 จัดการคำสั่ง Slash
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
      embedColor: "#FFD700"
    };

  try {
    if (commandName === "setchannel") {
      const channel = options.getChannel("channel");
      config[guildId].summaryChannel = channel.id;
      saveConfig();
      return interaction.reply({ content: `✅ ตั้งค่าช่องสรุปเป็น ${channel}`, ephemeral: true });
    }

    if (commandName === "setannounce") {
      const channel = options.getChannel("channel");
      config[guildId].announceChannel = channel.id;
      config[guildId].announceMessage = options.getString("message");
      config[guildId].embedImage = options.getString("image");
      config[guildId].embedColor = options.getString("color") || "#FFD700";
      saveConfig();

      // ส่งประกาศทันที
      const announceEmbed = new EmbedBuilder()
        .setTitle("📢 ประกาศฟอร์ม")
        .setDescription(config[guildId].announceMessage)
        .setColor(config[guildId].embedColor);
      if (config[guildId].embedImage) announceEmbed.setImage(config[guildId].embedImage);

      const announceChannel = await client.channels.fetch(config[guildId].announceChannel).catch(()=>null);
      if(announceChannel) await announceChannel.send({ embeds:[announceEmbed] });

      return interaction.reply({ content: `✅ ตั้งค่าการประกาศและประกาศเรียบร้อย`, ephemeral:true });
    }

    if (commandName === "setsummary") {
      config[guildId].summaryMessage = options.getString("message");
      saveConfig();
      return interaction.reply({ content: `✅ ตั้ง template สรุปเรียบร้อย`, ephemeral: true });
    }

    if (commandName === "setrole") {
      const role = options.getRole("role");
      config[guildId].roleToGive = role.id;
      saveConfig();
      return interaction.reply({ content: `✅ ตั้ง role ที่จะมอบหลังกรอกฟอร์มเป็น: ${role.name}`, ephemeral: true });
    }

    if (commandName === "preview") {
      const guildConfig = config[guildId];
      const dummy = { OC:"Luna", OC_AGE:"17", IC:"Shiki", IC_AGE:"25", HEIGHT:"175cm", SPECIES:"Furry Fox", DISCORD:"Shiki#1234", HISTORY:"นักผจญภัย"};
      
      const announceEmbed = new EmbedBuilder()
        .setTitle("📢 ตัวอย่างประกาศ")
        .setDescription(guildConfig.announceMessage || "กรอกฟอร์มเพื่อสมัครตัวละคร")
        .setColor(guildConfig.embedColor);
      if (guildConfig.embedImage) announceEmbed.setImage(guildConfig.embedImage);

      await interaction.reply({ embeds:[announceEmbed], ephemeral:true });

      if(guildConfig.summaryMessage){
        const summaryEmbed = new EmbedBuilder()
          .setTitle("📝 ตัวอย่างสรุป")
          .setColor(guildConfig.embedColor);
        const fields = guildConfig.summaryMessage.match(/\{(.*?)\}/g);
        fields?.forEach(f => {
          const key = f.replace(/[{}]/g,'');
          summaryEmbed.addFields({ name:key, value:dummy[key]||"ไม่ระบุ", inline:true });
        });
        if(guildConfig.embedImage) summaryEmbed.setImage(guildConfig.embedImage);
        await interaction.followUp({ embeds:[summaryEmbed], ephemeral:true });
      }
    }

    if (commandName === "clearsetting") {
      config[guildId] = {
        summaryChannel: null,
        announceChannel: null,
        announceMessage: null,
        summaryMessage: null,
        roleToGive: null,
        embedImage: null,
        embedColor: "#FFD700"
      };
      saveConfig();
      return interaction.reply({ content:"🧹 ล้างค่าการตั้งค่าของเซิร์ฟเรียบร้อย!", ephemeral:true });
    }

  } catch(err){
    console.error(err);
    interaction.reply({ content:"❌ เกิดข้อผิดพลาด!", ephemeral:true });
  }
});

// 📨 รับข้อมูลจากเว็บฟอร์ม (เฉพาะ roleplayfrom.vercel.app เท่านั้น)
app.post("/submit", async (req,res)=>{
  try{
    if (req.headers.origin !== allowedOrigin)
      return res.status(403).send("❌ ไม่อนุญาตจากต้นทางนี้");

    const data = req.body;
    const targetGuildId = Object.keys(config)[0];
    if(!targetGuildId) return res.status(400).send("❌ ไม่พบเซิร์ฟเวอร์");

    const guildConfig = config[targetGuildId];
    const channel = await client.channels.fetch(guildConfig.summaryChannel).catch(()=>null);
    if(!channel) return res.status(404).send("❌ ไม่พบช่องสำหรับสรุป");

    const summaryEmbed = new EmbedBuilder().setTitle("📝 ข้อมูลใหม่").setColor(guildConfig.embedColor);
    if(guildConfig.summaryMessage){
      const fields = guildConfig.summaryMessage.match(/\{(.*?)\}/g);
      fields?.forEach(f=>{
        const key = f.replace(/[{}]/g,'');
        summaryEmbed.addFields({ name:key, value:data[key.toLowerCase()]||"ไม่ระบุ", inline:true });
      });
    }
    if(guildConfig.embedImage) summaryEmbed.setImage(guildConfig.embedImage);

    await channel.send({ embeds:[summaryEmbed] });

    // 🎖️ มอบ Role
    if(guildConfig.roleToGive && data.discord_id){
      const guild = await client.guilds.fetch(targetGuildId);
      await guild.members.fetch();
      const member = guild.members.cache.get(data.discord_id);
      if(member){
        const role = guild.roles.cache.get(guildConfig.roleToGive);
        if(role && !member.roles.cache.has(role.id)) await member.roles.add(role);
      }
    }

    res.send({status:"ok"});
  } catch(err){
    console.error(err);
    res.status(500).send({status:"error", error:err.message});
  }
});

app.listen(5000,()=>console.log("🌐 Web API รันที่พอร์ต 5000 และเชื่อมกับ https://roleplayfrom.vercel.app"));