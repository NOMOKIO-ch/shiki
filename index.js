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
  ActionRowBuilder
} from "discord.js";
import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

const CONFIG_FILE = "./config.json";
const DEFAULT_URL = "https://roleplayfrom.vercel.app/";

let config = fs.existsSync(CONFIG_FILE)
  ? JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"))
  : {};

function saveConfig() {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// บอทออนไลน์
client.once("ready", () => {
  console.log(`✅ บอทออนไลน์แล้วในชื่อ ${client.user.tag}`);
});

client.login(process.env.BOT_TOKEN)
  .then(() => console.log("✅ Login สำเร็จ"))
  .catch(err => console.error("❌ Login ไม่สำเร็จ:", err));

// คำสั่ง
const commands = [
  new SlashCommandBuilder()
    .setName("setchanel")
    .setDescription("ตั้งค่าช่องสรุปข้อมูลฟอร์ม")
    .addChannelOption(opt => opt.setName("channel").setDescription("ช่องสรุป").setRequired(true)),

  new SlashCommandBuilder()
    .setName("setannounce")
    .setDescription("ตั้งข้อความประกาศฟอร์ม")
    .addStringOption(opt => opt.setName("message").setDescription("ข้อความประกาศ").setRequired(true))
    .addStringOption(opt => opt.setName("url").setDescription("ลิงก์ฟอร์ม (default ใช้ค่าเดิม)"))
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

// จัดการคำสั่ง
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName, options, guildId } = interaction;

  if (!config[guildId])
    config[guildId] = { privateChannel: null, roleToGive: null, announceMessage: null, summaryMessage: null, embedImage: null, embedColor: "#FFD700" };

  try {
    // setchanel
    if (commandName === "setchanel") {
      const channel = options.getChannel("channel");
      config[guildId].privateChannel = channel.id;
      saveConfig();
      return interaction.reply({ content: `✅ ตั้งค่าช่องสรุปเป็น ${channel}`, ephemeral: true });
    }

    // setannounce
    if (commandName === "setannounce") {
      config[guildId].announceMessage = options.getString("message");
      config[guildId].embedImage = options.getString("image");
      config[guildId].embedColor = options.getString("color") || "#FFD700";
      saveConfig();
      return interaction.reply({ content: `✅ ตั้งประกาศฟอร์มเรียบร้อย`, ephemeral: true });
    }

    // setsummary
    if (commandName === "setsummary") {
      config[guildId].summaryMessage = options.getString("message");
      saveConfig();
      return interaction.reply({ content: `✅ ตั้ง template สรุปเรียบร้อย`, ephemeral: true });
    }

    // setrole
    if (commandName === "setrole") {
      const role = options.getRole("role");
      config[guildId].roleToGive = role.id;
      saveConfig();
      return interaction.reply({ content: `✅ ตั้ง role หลังกรอกฟอร์ม: ${role.name}`, ephemeral: true });
    }

    // preview
    if (commandName === "preview") {
      const guildConfig = config[guildId];
      const dummy = { OC:"Luna", OC_AGE:"17", IC:"Shiki", IC_AGE:"25", HEIGHT:"175cm", SPECIES:"Furry Fox", DISCORD:"Shiki#1234", HISTORY:"นักผจญภัย"};

      const announceEmbed = new EmbedBuilder()
        .setTitle("📢 ตัวอย่างประกาศ")
        .setDescription(guildConfig.announceMessage || "กรอกฟอร์มเพื่อสมัครตัวละคร")
        .setColor(guildConfig.embedColor);
      if (guildConfig.embedImage) announceEmbed.setImage(guildConfig.embedImage);

      const button = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel("🔗 ตัวอย่างฟอร์ม").setStyle(ButtonStyle.Link).setURL(DEFAULT_URL)
      );

      await interaction.reply({ embeds: [announceEmbed], components: [button] });

      const summaryEmbed = new EmbedBuilder().setTitle("📝 ตัวอย่างสรุป").setColor(guildConfig.embedColor);
      if (guildConfig.summaryMessage) {
        const fields = guildConfig.summaryMessage.match(/\{(.*?)\}/g);
        fields?.forEach(f => {
          const key = f.replace(/[{}]/g,'');
          summaryEmbed.addFields({ name:key, value:dummy[key]||"ไม่ระบุ", inline:true });
        });
      }
      if (guildConfig.embedImage) summaryEmbed.setImage(guildConfig.embedImage);
      await interaction.followUp({ embeds:[summaryEmbed] });
    }

    // clearsetting
    if (commandName === "clearsetting") {
      config[guildId] = { privateChannel:null, roleToGive:null, announceMessage:null, summaryMessage:null, embedImage:null, embedColor:"#FFD700" };
      saveConfig();
      return interaction.reply({ content:"🧹 ล้างค่าการตั้งค่าของเซิร์ฟเรียบร้อย!", ephemeral:true });
    }

  } catch(err) {
    console.error(err);
    interaction.reply({ content:"❌ เกิดข้อผิดพลาด!", ephemeral:true });
  }
});

// รับข้อมูลฟอร์ม
app.post("/submit", async (req,res)=>{
  try{
    const data = req.body;
    const guildId = data.guild_id;
    if(!guildId || !config[guildId]) 
      return res.status(400).send("❌ ไม่พบเซิร์ฟเวอร์นี้");

    const guildConfig = config[guildId];
    const channel = await client.channels.fetch(guildConfig.privateChannel).catch(()=>null);
    if(!channel) return res.status(404).send("❌ ไม่พบช่อง");

    // ส่งสรุป
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

    // มอบ Role
    if(guildConfig.roleToGive && data.discord_id){
      const guild = await client.guilds.fetch(guildId);
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

app.listen(3000,()=>console.log("🌐 Web API รันที่พอร์ต 3000"));
