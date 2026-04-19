const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, REST, Routes } = require('discord.js');
const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const { MongoClient } = require('mongodb');
const path = require('path');
require('dotenv').config();

// ─── Config ───────────────────────────────────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const PANEL_URL = process.env.PANEL_URL || 'http://localhost:3000';
const PORT = process.env.PORT || 3000;
const MONGO_URL = process.env.MONGO_URL;
const ORDER_WEBHOOK = process.env.ORDER_WEBHOOK || '';

// ─── ID du serveur Discord ────────────────────────────────────────────────────
const GUILD_ID = '1495077016515514408'; // ← REMPLACE PAR TON ID SERVEUR

// ─── MongoDB ──────────────────────────────────────────────────────────────────
let db;
async function connectDB() {
  const client = new MongoClient(MONGO_URL);
  await client.connect();
  db = client.db('rp_shop');
  
  const collections = await db.listCollections().toArray();
  const collectionNames = collections.map(c => c.name);
  
  if (!collectionNames.includes('shop')) await db.createCollection('shop');
  if (!collectionNames.includes('orders')) await db.createCollection('orders');
  if (!collectionNames.includes('config')) await db.createCollection('config');
  
  console.log('✅ MongoDB connecté !');
}
function col(name) { return db.collection(name); }

// ─── Discord Client ───────────────────────────────────────────────────────────
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function generateOrderId() { return 'CMD-' + uuidv4().slice(0, 8).toUpperCase(); }

async function sendWebhook(embed) {
  if (!ORDER_WEBHOOK) return;
  try {
    await fetch(ORDER_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ embeds: [embed] }) });
  } catch (e) {}
}

// ─── Slash Commands ───────────────────────────────────────────────────────────
const commands = [
  new SlashCommandBuilder().setName('catalogue').setDescription('Voir le catalogue').addStringOption(o => o.setName('categorie').setDescription('Filtrer').setRequired(false)),
  new SlashCommandBuilder().setName('commander').setDescription('Passer une commande').addStringOption(o => o.setName('article').setDescription('Nom ou ID').setRequired(true)).addIntegerOption(o => o.setName('quantite').setDescription('Quantité').setRequired(false)).addStringOption(o => o.setName('details').setDescription('Précisions').setRequired(false)),
  new SlashCommandBuilder().setName('mescommandes').setDescription('Voir vos commandes'),
  new SlashCommandBuilder().setName('validercommande').setDescription('[VENDEUR] Valider').addStringOption(o => o.setName('id').setDescription('ID commande').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  new SlashCommandBuilder().setName('refusercommande').setDescription('[VENDEUR] Refuser').addStringOption(o => o.setName('id').setDescription('ID commande').setRequired(true)).addStringOption(o => o.setName('raison').setDescription('Raison').setRequired(false)).setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  new SlashCommandBuilder().setName('livrercommande').setDescription('[VENDEUR] Livrer').addStringOption(o => o.setName('id').setDescription('ID commande').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  new SlashCommandBuilder().setName('panelvendeur').setDescription('[VENDEUR] Lien panel'),
  new SlashCommandBuilder().setName('addarticle').setDescription('[ADMIN] Ajouter article').addStringOption(o => o.setName('nom').setDescription('Nom').setRequired(true)).addStringOption(o => o.setName('categorie').setDescription('Catégorie').setRequired(true)).addIntegerOption(o => o.setName('prix').setDescription('Prix').setRequired(false)).addStringOption(o => o.setName('description').setDescription('Description').setRequired(false)).addStringOption(o => o.setName('image').setDescription('URL image').setRequired(false)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('removearticle').setDescription('[ADMIN] Supprimer').addStringOption(o => o.setName('id').setDescription('ID article').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('editarticle').setDescription('[ADMIN] Modifier').addStringOption(o => o.setName('id').setDescription('ID article').setRequired(true)).addIntegerOption(o => o.setName('prix').setDescription('Prix').setRequired(false)).addStringOption(o => o.setName('description').setDescription('Description').setRequired(false)).addStringOption(o => o.setName('categorie').setDescription('Catégorie').setRequired(false)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
];

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
  try { await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands.map(c => c.toJSON()) }); console.log('✅ Commandes enregistrées'); } catch (e) {}
}

client.once('ready', async () => { console.log(`🤖 ${client.user.tag} connecté !`); await registerCommands(); });

// ─── Interactions ─────────────────────────────────────────────────────────────
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName, options, guild, user } = interaction;
  try {
    if (commandName === 'panelvendeur') await interaction.deferReply({ flags: 64 });
    else await interaction.deferReply();
    
    if (commandName === 'catalogue') {
      const categorie = options.getString('categorie');
      const items = (await col('shop').findOne({ guildId: guild.id }))?.items || [];
      let filtered = categorie ? items.filter(i => i.categorie?.toLowerCase() === categorie.toLowerCase()) : items;
      if (!filtered.length) return interaction.editReply({ content: '❌ Aucun article.' });
      const byCat = {}; filtered.forEach(i => { const c = i.categorie || 'Autre'; if (!byCat[c]) byCat[c] = []; byCat[c].push(i); });
      const embed = new EmbedBuilder().setTitle('🏪 Catalogue').setColor(0x57F287);
      for (const [cat, catItems] of Object.entries(byCat)) {
        embed.addFields({ name: `📦 ${cat}`, value: catItems.map(i => `**${i.nom}**${i.prix ? ` — ${i.prix}💰` : ''}\n> \`${i.id}\`\n> ${i.description || ''}`).join('\n\n').slice(0, 1024) });
      }
      await interaction.editReply({ embeds: [embed] });
    }
    
    if (commandName === 'commander') {
      const query = options.getString('article').toLowerCase();
      const qte = options.getInteger('quantite') || 1;
      const details = options.getString('details') || '';
      const item = (await col('shop').findOne({ guildId: guild.id }))?.items?.find(i => i.id.toLowerCase() === query || i.nom.toLowerCase().includes(query));
      if (!item) return interaction.editReply({ content: '❌ Introuvable.' });
      const embed = new EmbedBuilder().setTitle('🛒 Confirmation').setColor(0xFEE75C).setDescription(`**${qte}x ${item.nom}**`).setFooter({ text: '✅ Confirmer' });
      if (item.prix) embed.addFields({ name: '💰', value: `${item.prix} 💰`, inline: true });
      if (details) embed.addFields({ name: '📝', value: details });
      const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`confirm_${item.id}_${qte}_${details ? encodeURIComponent(details) : 'none'}`).setLabel('✅').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId('cancel_order').setLabel('❌').setStyle(ButtonStyle.Danger));
      await interaction.editReply({ embeds: [embed], components: [row] });
    }
    
    if (commandName === 'mescommandes') {
      const orders = await col('orders').find({ guildId: guild.id, userId: user.id }).sort({ createdAt: -1 }).limit(10).toArray();
      if (!orders.length) return interaction.editReply({ content: '📭 Aucune commande.' });
      const embed = new EmbedBuilder().setTitle(`📋 ${user.username}`).setColor(0x5865F2);
      const st = { 'en_attente': '🟡 En attente', 'validee': '🟢 Validée', 'livree': '✅ Livrée', 'refusee': '🔴 Refusée' };
      orders.forEach(o => embed.addFields({ name: `${o.orderId} — ${st[o.status] || o.status}`, value: `${o.items.map(i => `${i.quantite}x ${i.nom}`).join('\n')}${o.details ? `\n📝 ${o.details}` : ''}` }));
      await interaction.editReply({ embeds: [embed] });
    }
    
    if (commandName === 'panelvendeur') {
      await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🛡️ Panel').setColor(0x5865F2).setDescription(`[Accéder](${PANEL_URL}/?guild=${guild.id})`)] });
    }
    
    if (commandName === 'validercommande') {
      const o = await col('orders').findOne({ guildId: guild.id, orderId: options.getString('id') });
      if (!o) return interaction.editReply({ content: '❌ Introuvable.' });
      if (o.status !== 'en_attente') return interaction.editReply({ content: `❌ Déjà ${o.status}.` });
      await col('orders').updateOne({ guildId: guild.id, orderId: o.orderId }, { $set: { status: 'validee', staffId: user.id, staffTag: user.tag, validatedAt: new Date().toISOString() } });
      await sendWebhook(new EmbedBuilder().setTitle('✅ Validée').setColor(0x57F287).setDescription(`**${o.orderId}** par ${user.tag}`).addFields({ name: '👤', value: `<@${o.userId}>` }, { name: '🛒', value: o.items.map(i => `${i.quantite}x ${i.nom}`).join('\n') }));
      try { await (await guild.members.fetch(o.userId)).send({ embeds: [new EmbedBuilder().setTitle('✅ Validée').setColor(0x57F287).setDescription(`**${o.orderId}** validée.`)] }); } catch {}
      await interaction.editReply({ content: `✅ ${o.orderId} validée.` });
    }
    
    if (commandName === 'refusercommande') {
      const o = await col('orders').findOne({ guildId: guild.id, orderId: options.getString('id') });
      if (!o) return interaction.editReply({ content: '❌ Introuvable.' });
      const raison = options.getString('raison') || 'Aucune';
      await col('orders').updateOne({ guildId: guild.id, orderId: o.orderId }, { $set: { status: 'refusee', staffId: user.id, staffTag: user.tag, raisonRefus: raison, validatedAt: new Date().toISOString() } });
      await sendWebhook(new EmbedBuilder().setTitle('❌ Refusée').setColor(0xED4245).setDescription(`**${o.orderId}** par ${user.tag}`).addFields({ name: '📝', value: raison }));
      try { await (await guild.members.fetch(o.userId)).send({ embeds: [new EmbedBuilder().setTitle('❌ Refusée').setColor(0xED4245).setDescription(`**${o.orderId}** refusée.\n${raison}`)] }); } catch {}
      await interaction.editReply({ content: `❌ ${o.orderId} refusée.` });
    }
    
    if (commandName === 'livrercommande') {
      const o = await col('orders').findOne({ guildId: guild.id, orderId: options.getString('id') });
      if (!o) return interaction.editReply({ content: '❌ Introuvable.' });
      if (o.status !== 'validee') return interaction.editReply({ content: `❌ Doit être validée.` });
      await col('orders').updateOne({ guildId: guild.id, orderId: o.orderId }, { $set: { status: 'livree', deliveredAt: new Date().toISOString() } });
      await sendWebhook(new EmbedBuilder().setTitle('🚚 Livrée').setColor(0x5352ed).setDescription(`**${o.orderId}** par ${user.tag}`));
      try { await (await guild.members.fetch(o.userId)).send({ embeds: [new EmbedBuilder().setTitle('🚚 Livrée').setColor(0x57F287).setDescription(`**${o.orderId}** livrée !`)] }); } catch {}
      await interaction.editReply({ content: `✅ ${o.orderId} livrée.` });
    }
    
    if (commandName === 'addarticle') {
      const item = { id: options.getString('nom').toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + uuidv4().slice(0,4), nom: options.getString('nom'), categorie: options.getString('categorie'), description: options.getString('description') || '', image: options.getString('image') || '', createdAt: new Date().toISOString(), prix: options.getInteger('prix') || null };
      await col('shop').updateOne({ guildId: guild.id }, { $push: { items: item } }, { upsert: true });
      await interaction.editReply({ content: `✅ ${item.nom} ajouté (ID: \`${item.id}\`)` });
    }
    
    if (commandName === 'removearticle') {
      const r = await col('shop').updateOne({ guildId: guild.id }, { $pull: { items: { id: options.getString('id') } } });
      if (!r.modifiedCount) return interaction.editReply({ content: '❌ Introuvable.' });
      await interaction.editReply({ content: '✅ Supprimé.' });
    }
    
    if (commandName === 'editarticle') {
      const upd = {};
      if (options.getInteger('prix') !== null) upd['items.$.prix'] = options.getInteger('prix');
      if (options.getString('description')) upd['items.$.description'] = options.getString('description');
      if (options.getString('categorie')) upd['items.$.categorie'] = options.getString('categorie');
      const r = await col('shop').updateOne({ guildId: guild.id, 'items.id': options.getString('id') }, { $set: upd });
      if (!r.modifiedCount) return interaction.editReply({ content: '❌ Introuvable.' });
      await interaction.editReply({ content: '✅ Modifié.' });
    }
  } catch (e) { await interaction.editReply({ content: '❌ Erreur.' }).catch(() => {}); }
});

// ─── Buttons ──────────────────────────────────────────────────────────────────
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  if (interaction.customId === 'cancel_order') return interaction.update({ content: '❌ Annulé.', embeds: [], components: [] });
  if (interaction.customId.startsWith('confirm_')) {
    const [, id, qte, det] = interaction.customId.split('_');
    const details = det === 'none' ? '' : decodeURIComponent(det);
    const item = (await col('shop').findOne({ guildId: interaction.guild.id }))?.items?.find(i => i.id === id);
    if (!item) return interaction.update({ content: '❌ Introuvable.', embeds: [], components: [] });
    const order = { guildId: interaction.guild.id, orderId: generateOrderId(), userId: interaction.user.id, userTag: interaction.user.tag, items: [{ itemId: item.id, nom: item.nom, quantite: parseInt(qte) }], details, status: 'en_attente', createdAt: new Date().toISOString() };
    await col('orders').insertOne(order);
    await sendWebhook(new EmbedBuilder().setTitle('🛒 Nouvelle commande').setColor(0xFEE75C).setDescription(`**${order.orderId}**`).addFields({ name: '👤', value: `<@${interaction.user.id}>` }, { name: '🛒', value: `${qte}x ${item.nom}` }));
    await interaction.update({ embeds: [new EmbedBuilder().setTitle('✅ Enregistrée').setColor(0x57F287).setDescription(`**${order.orderId}**\n${qte}x ${item.nom}`)], components: [] });
  }
});

// ─── Express API ──────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// API pour le panel vendeur (SANS AUTHENTIFICATION)
app.get('/api/orders', async (req, res) => {
  const { guild } = req.query;
  if (!guild) return res.status(400).json({ error: 'Guild ID requis' });
  res.json(await col('orders').find({ guildId: guild }).sort({ createdAt: -1 }).toArray());
});

app.patch('/api/orders/:orderId', async (req, res) => {
  const { guild, status, raisonRefus } = req.body;
  if (!guild) return res.status(400).json({ error: 'Guild ID requis' });
  const upd = { status };
  if (raisonRefus) upd.raisonRefus = raisonRefus;
  if (status === 'validee' || status === 'refusee') { upd.validatedAt = new Date().toISOString(); }
  if (status === 'livree') upd.deliveredAt = new Date().toISOString();
  await col('orders').updateOne({ guildId: guild, orderId: req.params.orderId }, { $set: upd });
  res.json({ success: true });
});

app.get('/api/shop', async (req, res) => {
  const { guild } = req.query;
  if (!guild) return res.status(400).json({ error: 'Guild ID requis' });
  res.json((await col('shop').findOne({ guildId: guild }))?.items || []);
});

app.post('/api/shop', async (req, res) => {
  const { guild, nom, categorie, prix, description, image } = req.body;
  if (!guild) return res.status(400).json({ error: 'Guild ID requis' });
  const item = { id: nom.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + uuidv4().slice(0,4), nom, categorie, description: description || '', image: image || '', prix: prix || null, createdAt: new Date().toISOString() };
  await col('shop').updateOne({ guildId: guild }, { $push: { items: item } }, { upsert: true });
  res.json(item);
});

app.patch('/api/shop/:itemId', async (req, res) => {
  const { guild, prix, description, categorie } = req.body;
  if (!guild) return res.status(400).json({ error: 'Guild ID requis' });
  const upd = {};
  if (prix !== undefined) upd['items.$.prix'] = prix;
  if (description) upd['items.$.description'] = description;
  if (categorie) upd['items.$.categorie'] = categorie;
  await col('shop').updateOne({ guildId: guild, 'items.id': req.params.itemId }, { $set: upd });
  res.json({ success: true });
});

app.delete('/api/shop/:itemId', async (req, res) => {
  const { guild } = req.query;
  if (!guild) return res.status(400).json({ error: 'Guild ID requis' });
  await col('shop').updateOne({ guildId: guild }, { $pull: { items: { id: req.params.itemId } } });
  res.json({ success: true });
});

// API publique joueurs
app.get('/api/public/shop/:guildId', async (req, res) => res.json((await col('shop').findOne({ guildId: req.params.guildId }))?.items || []));
app.get('/api/public/orders/:userId', async (req, res) => {
  const { guild } = req.query;
  if (!guild) return res.status(400).json({ error: 'Guild ID requis' });
  res.json(await col('orders').find({ guildId: guild, userId: req.params.userId }).sort({ createdAt: -1 }).limit(30).toArray());
});
app.post('/api/public/orders', async (req, res) => {
  const { guildId, userId, items, details } = req.body;
  if (!guildId || !userId || !items?.length) return res.status(400).json({ error: 'Données manquantes' });
  const order = { guildId, orderId: generateOrderId(), userId, userTag: userId, items, details, status: 'en_attente', createdAt: new Date().toISOString() };
  await col('orders').insertOne(order);
  if (ORDER_WEBHOOK) {
    try {
      const embed = new EmbedBuilder().setTitle('🛒 Nouvelle commande (Site)').setColor(0xFEE75C).setDescription(`**${order.orderId}**`).addFields({ name: '👤', value: userId }, { name: '🛒', value: items.map(i => `${i.quantite}x ${i.nom}`).join('\n') });
      if (details) embed.addFields({ name: '📝', value: details });
      await fetch(ORDER_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ embeds: [embed.toJSON()] }) });
    } catch {}
  }
  res.json({ success: true, orderId: order.orderId });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', req.path.startsWith('/joueur') ? 'joueur.html' : 'index.html')));

// ─── Start ────────────────────────────────────────────────────────────────────
async function start() {
  await connectDB();
  app.listen(PORT, () => console.log(`🌐 Panel: ${PANEL_URL}`));
  await client.login(BOT_TOKEN);
}
start();
