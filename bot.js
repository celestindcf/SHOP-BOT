const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, REST, Routes } = require('discord.js');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { MongoClient } = require('mongodb');
const path = require('path');
require('dotenv').config();

// ─── Config ───────────────────────────────────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const JWT_SECRET = process.env.JWT_SECRET || 'secret-tres-long-a-changer';
const PANEL_URL = process.env.PANEL_URL || 'http://localhost:3000';
const PORT = process.env.PORT || 3000;
const MONGO_URL = process.env.MONGO_URL 
const ORDER_WEBHOOK = process.env.ORDER_WEBHOOK || '';

// ─── MongoDB (Création auto des collections) ──────────────────────────────────
let db;
async function connectDB() {
  const client = new MongoClient(MONGO_URL);
  await client.connect();
  db = client.db('rp_shop');
  
  // Créer les collections automatiquement si elles n'existent pas
  const collections = await db.listCollections().toArray();
  const collectionNames = collections.map(c => c.name);
  
  if (!collectionNames.includes('shop')) {
    await db.createCollection('shop');
    console.log('✅ Collection "shop" créée');
  }
  if (!collectionNames.includes('orders')) {
    await db.createCollection('orders');
    console.log('✅ Collection "orders" créée');
  }
  if (!collectionNames.includes('users')) {
    await db.createCollection('users');
    console.log('✅ Collection "users" créée');
    // Créer un compte admin par défaut
    const hashedPwd = await bcrypt.hash('admin123', 10);
    await db.collection('users').insertOne({
      id: uuidv4(),
      username: 'admin',
      password: hashedPwd,
      guildId: 'default',
      role: 'admin',
      createdAt: new Date().toISOString()
    });
    console.log('✅ Compte admin créé (admin / admin123)');
  }
  if (!collectionNames.includes('config')) {
    await db.createCollection('config');
    console.log('✅ Collection "config" créée');
  }
  
  console.log('✅ MongoDB connecté et prêt !');
}
function col(name) { return db.collection(name); }

// ─── Discord Client ───────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function generateOrderId() {
  return 'CMD-' + uuidv4().slice(0, 8).toUpperCase();
}

async function sendWebhook(embed) {
  if (!ORDER_WEBHOOK) return;
  try {
    await fetch(ORDER_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] })
    });
  } catch (e) { console.error('Webhook error:', e.message); }
}

// ─── Slash Commands ───────────────────────────────────────────────────────────
const commands = [
  // 📋 JOUEUR
  new SlashCommandBuilder()
    .setName('catalogue')
    .setDescription('Voir le catalogue des articles disponibles')
    .addStringOption(o => o.setName('categorie').setDescription('Filtrer par catégorie').setRequired(false)),
    
  new SlashCommandBuilder()
    .setName('commander')
    .setDescription('Passer une commande')
    .addStringOption(o => o.setName('article').setDescription('Nom ou ID de l\'article').setRequired(true))
    .addIntegerOption(o => o.setName('quantite').setDescription('Quantité (défaut: 1)').setRequired(false))
    .addStringOption(o => o.setName('details').setDescription('Précisions supplémentaires').setRequired(false)),
    
  new SlashCommandBuilder()
    .setName('mescommandes')
    .setDescription('Voir l\'historique de vos commandes'),
    
  // 🛡️ VENDEUR / STAFF
  new SlashCommandBuilder()
    .setName('validercommande')
    .setDescription('[VENDEUR] Valider une commande')
    .addStringOption(o => o.setName('id').setDescription('ID de la commande').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    
  new SlashCommandBuilder()
    .setName('refusercommande')
    .setDescription('[VENDEUR] Refuser une commande')
    .addStringOption(o => o.setName('id').setDescription('ID de la commande').setRequired(true))
    .addStringOption(o => o.setName('raison').setDescription('Raison du refus').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    
  new SlashCommandBuilder()
    .setName('livrercommande')
    .setDescription('[VENDEUR] Marquer une commande comme livrée')
    .addStringOption(o => o.setName('id').setDescription('ID de la commande').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    
  new SlashCommandBuilder()
    .setName('panelvendeur')
    .setDescription('[VENDEUR] Lien vers le panel de gestion'),
    
  // 🔧 ADMIN
  new SlashCommandBuilder()
    .setName('addarticle')
    .setDescription('[ADMIN] Ajouter un article au catalogue')
    .addStringOption(o => o.setName('nom').setDescription('Nom de l\'article').setRequired(true))
    .addStringOption(o => o.setName('categorie').setDescription('Catégorie').setRequired(true))
    .addIntegerOption(o => o.setName('prix').setDescription('Prix (affichage uniquement)').setRequired(false))
    .addStringOption(o => o.setName('description').setDescription('Description').setRequired(false))
    .addStringOption(o => o.setName('image').setDescription('URL de l\'image').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    
  new SlashCommandBuilder()
    .setName('removearticle')
    .setDescription('[ADMIN] Supprimer un article')
    .addStringOption(o => o.setName('id').setDescription('ID de l\'article').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    
  new SlashCommandBuilder()
    .setName('editarticle')
    .setDescription('[ADMIN] Modifier un article')
    .addStringOption(o => o.setName('id').setDescription('ID de l\'article').setRequired(true))
    .addIntegerOption(o => o.setName('prix').setDescription('Nouveau prix').setRequired(false))
    .addStringOption(o => o.setName('description').setDescription('Nouvelle description').setRequired(false))
    .addStringOption(o => o.setName('categorie').setDescription('Nouvelle catégorie').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
];

// ─── Register Commands ────────────────────────────────────────────────────────
async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands.map(c => c.toJSON()) });
    console.log('✅ Commandes enregistrées !');
  } catch (e) { console.error('❌', e); }
}

// ─── Bot Events ───────────────────────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`🤖 ${client.user.tag} connecté !`);
  await registerCommands();
});

// ─── Interactions ─────────────────────────────────────────────────────────────
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  
  const { commandName, options, guild, user } = interaction;
  
  try {
    await interaction.deferReply({ ephemeral: commandName === 'panelvendeur' });
    
    // ─── CATALOGUE ─────────────────────────────────────────────────────────────
    if (commandName === 'catalogue') {
      const categorie = options.getString('categorie');
      const shopData = await col('shop').findOne({ guildId: guild.id });
      const items = shopData?.items || [];
      
      let filteredItems = items;
      if (categorie) {
        filteredItems = items.filter(i => i.categorie?.toLowerCase() === categorie.toLowerCase());
      }
      
      if (filteredItems.length === 0) {
        return interaction.editReply({ content: '❌ Aucun article trouvé.' });
      }
      
      const byCategory = {};
      filteredItems.forEach(item => {
        const cat = item.categorie || 'Autre';
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push(item);
      });
      
      const embed = new EmbedBuilder()
        .setTitle('🏪 Catalogue RP')
        .setColor(0x57F287)
        .setDescription('Voici les articles disponibles à la commande :')
        .setThumbnail(guild.iconURL())
        .setTimestamp();
      
      for (const [cat, catItems] of Object.entries(byCategory)) {
        const itemList = catItems.map(i => {
          const priceDisplay = i.prix ? ` — **${i.prix}** 💰` : '';
          return `**${i.nom}**${priceDisplay}\n> ID: \`${i.id}\`\n> ${i.description || 'Aucune description'}`;
        }).join('\n\n');
        embed.addFields({ name: `📦 ${cat}`, value: itemList.slice(0, 1024) });
      }
      
      embed.setFooter({ text: 'Utilise /commander article:<nom ou ID> pour passer commande' });
      
      await interaction.editReply({ embeds: [embed] });
    }
    
    // ─── COMMANDER ─────────────────────────────────────────────────────────────
    if (commandName === 'commander') {
      const articleQuery = options.getString('article').toLowerCase();
      const quantite = options.getInteger('quantite') || 1;
      const details = options.getString('details') || '';
      
      const shopData = await col('shop').findOne({ guildId: guild.id });
      const items = shopData?.items || [];
      
      const item = items.find(i => 
        i.id.toLowerCase() === articleQuery || 
        i.nom.toLowerCase().includes(articleQuery)
      );
      
      if (!item) {
        return interaction.editReply({ content: '❌ Article introuvable. Utilise `/catalogue` pour voir les articles disponibles.' });
      }
      
      const confirmEmbed = new EmbedBuilder()
        .setTitle('🛒 Confirmation de commande')
        .setColor(0xFEE75C)
        .setDescription(`Vous allez commander :\n\n**${quantite}x ${item.nom}**`)
        .setFooter({ text: 'Cliquez sur ✅ pour confirmer' });
      
      if (item.prix) {
        confirmEmbed.addFields({ name: '💰 Prix indicatif', value: `${item.prix} 💰`, inline: true });
      }
      if (details) {
        confirmEmbed.addFields({ name: '📝 Détails', value: details, inline: false });
      }
      
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`confirm_order_${item.id}_${quantite}_${details ? encodeURIComponent(details) : 'none'}`).setLabel('✅ Confirmer').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('cancel_order').setLabel('❌ Annuler').setStyle(ButtonStyle.Danger)
      );
      
      await interaction.editReply({ embeds: [confirmEmbed], components: [row] });
    }
    
    // ─── MESCOMMANDES ──────────────────────────────────────────────────────────
    if (commandName === 'mescommandes') {
      const orders = await col('orders').find({ 
        guildId: guild.id, 
        userId: user.id 
      }).sort({ createdAt: -1 }).limit(10).toArray();
      
      if (orders.length === 0) {
        return interaction.editReply({ content: '📭 Vous n\'avez aucune commande.' });
      }
      
      const embed = new EmbedBuilder()
        .setTitle(`📋 Vos commandes — ${user.username}`)
        .setColor(0x5865F2)
        .setThumbnail(user.displayAvatarURL());
      
      orders.forEach(order => {
        const statusEmojis = {
          'en_attente': '🟡 En attente',
          'validee': '🟢 Validée',
          'livree': '✅ Livrée',
          'refusee': '🔴 Refusée'
        };
        
        const itemsList = order.items.map(i => `• ${i.quantite}x ${i.nom}`).join('\n');
        const details = order.details ? `\n📝 ${order.details}` : '';
        
        embed.addFields({
          name: `📦 ${order.orderId} — ${statusEmojis[order.status] || order.status}`,
          value: `${itemsList}${details}\nDate : ${new Date(order.createdAt).toLocaleDateString('fr-FR')}`
        });
      });
      
      await interaction.editReply({ embeds: [embed] });
    }
    
    // ─── PANELVENDEUR ─────────────────────────────────────────────────────────
    if (commandName === 'panelvendeur') {
      const embed = new EmbedBuilder()
        .setTitle('🛡️ Panel Vendeur')
        .setColor(0x5865F2)
        .setDescription(`🔗 **[Accéder au panel](${PANEL_URL}/?guild=${guild.id})**`)
        .addFields({ name: '🔑 Accès', value: 'Réservé aux vendeurs. Connectez-vous avec vos identifiants.' });
      
      await interaction.editReply({ embeds: [embed] });
    }
    
    // ─── VALIDERCOMMANDE ──────────────────────────────────────────────────────
    if (commandName === 'validercommande') {
      const orderId = options.getString('id');
      
      const order = await col('orders').findOne({ guildId: guild.id, orderId });
      if (!order) {
        return interaction.editReply({ content: '❌ Commande introuvable.' });
      }
      
      if (order.status !== 'en_attente') {
        return interaction.editReply({ content: `❌ Cette commande est déjà ${order.status}.` });
      }
      
      await col('orders').updateOne(
        { guildId: guild.id, orderId },
        { $set: { 
          status: 'validee', 
          staffId: user.id, 
          staffTag: user.tag,
          validatedAt: new Date().toISOString()
        }}
      );
      
      const webhookEmbed = new EmbedBuilder()
        .setTitle('✅ Commande validée')
        .setColor(0x57F287)
        .setDescription(`**${orderId}** validée par ${user.tag}`)
        .addFields(
          { name: '👤 Client', value: `<@${order.userId}>`, inline: true },
          { name: '🛒 Articles', value: order.items.map(i => `${i.quantite}x ${i.nom}`).join('\n'), inline: false }
        )
        .setTimestamp();
      await sendWebhook(webhookEmbed);
      
      try {
        const member = await guild.members.fetch(order.userId);
        await member.send({ 
          embeds: [new EmbedBuilder()
            .setTitle('✅ Commande validée')
            .setColor(0x57F287)
            .setDescription(`Votre commande **${orderId}** a été validée par ${user.tag}.`)
          ]
        });
      } catch {}
      
      await interaction.editReply({ content: `✅ Commande **${orderId}** validée !` });
    }
    
    // ─── REFUSERCOMMANDE ──────────────────────────────────────────────────────
    if (commandName === 'refusercommande') {
      const orderId = options.getString('id');
      const raison = options.getString('raison') || 'Aucune raison fournie';
      
      const order = await col('orders').findOne({ guildId: guild.id, orderId });
      if (!order) {
        return interaction.editReply({ content: '❌ Commande introuvable.' });
      }
      
      await col('orders').updateOne(
        { guildId: guild.id, orderId },
        { $set: { 
          status: 'refusee', 
          staffId: user.id, 
          staffTag: user.tag,
          raisonRefus: raison,
          validatedAt: new Date().toISOString()
        }}
      );
      
      const webhookEmbed = new EmbedBuilder()
        .setTitle('❌ Commande refusée')
        .setColor(0xED4245)
        .setDescription(`**${orderId}** refusée par ${user.tag}`)
        .addFields({ name: '📝 Raison', value: raison });
      await sendWebhook(webhookEmbed);
      
      try {
        const member = await guild.members.fetch(order.userId);
        await member.send({ 
          embeds: [new EmbedBuilder()
            .setTitle('❌ Commande refusée')
            .setColor(0xED4245)
            .setDescription(`Votre commande **${orderId}** a été refusée.\nRaison : ${raison}`)
          ]
        });
      } catch {}
      
      await interaction.editReply({ content: `❌ Commande **${orderId}** refusée.` });
    }
    
    // ─── LIVRERCOMMANDE ───────────────────────────────────────────────────────
    if (commandName === 'livrercommande') {
      const orderId = options.getString('id');
      
      const order = await col('orders').findOne({ guildId: guild.id, orderId });
      if (!order) {
        return interaction.editReply({ content: '❌ Commande introuvable.' });
      }
      
      if (order.status !== 'validee') {
        return interaction.editReply({ content: `❌ Cette commande doit être validée avant livraison (statut actuel : ${order.status}).` });
      }
      
      await col('orders').updateOne(
        { guildId: guild.id, orderId },
        { $set: { 
          status: 'livree', 
          deliveredAt: new Date().toISOString()
        }}
      );
      
      const webhookEmbed = new EmbedBuilder()
        .setTitle('🚚 Commande livrée')
        .setColor(0x5352ed)
        .setDescription(`**${orderId}** marquée comme livrée par ${user.tag}`);
      await sendWebhook(webhookEmbed);
      
      try {
        const member = await guild.members.fetch(order.userId);
        await member.send({ 
          embeds: [new EmbedBuilder()
            .setTitle('🚚 Commande livrée')
            .setColor(0x57F287)
            .setDescription(`Votre commande **${orderId}** a été livrée ! Bon jeu !`)
          ]
        });
      } catch {}
      
      await interaction.editReply({ content: `✅ Commande **${orderId}** marquée comme livrée !` });
    }
    
    // ─── ADDARTICLE ───────────────────────────────────────────────────────────
    if (commandName === 'addarticle') {
      const nom = options.getString('nom');
      const categorie = options.getString('categorie');
      const prix = options.getInteger('prix');
      const description = options.getString('description') || '';
      const image = options.getString('image') || '';
      
      const itemId = nom.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + uuidv4().slice(0, 4);
      
      const item = {
        id: itemId,
        nom,
        categorie,
        description,
        image,
        createdAt: new Date().toISOString()
      };
      
      if (prix) item.prix = prix;
      
      await col('shop').updateOne(
        { guildId: guild.id },
        { $push: { items: item } },
        { upsert: true }
      );
      
      const embed = new EmbedBuilder()
        .setTitle('✅ Article ajouté')
        .setColor(0x57F287)
        .setDescription(`**${nom}** a été ajouté au catalogue !`)
        .addFields(
          { name: '📦 Catégorie', value: categorie, inline: true },
          { name: '🆔 ID', value: `\`${itemId}\``, inline: true }
        );
      
      if (prix) embed.addFields({ name: '💰 Prix', value: `${prix} 💰`, inline: true });
      if (image) embed.setImage(image);
      
      await interaction.editReply({ embeds: [embed] });
    }
    
    // ─── REMOVEARTICLE ────────────────────────────────────────────────────────
    if (commandName === 'removearticle') {
      const itemId = options.getString('id');
      
      const result = await col('shop').updateOne(
        { guildId: guild.id },
        { $pull: { items: { id: itemId } } }
      );
      
      if (result.modifiedCount === 0) {
        return interaction.editReply({ content: '❌ Article introuvable.' });
      }
      
      await interaction.editReply({ content: `✅ Article \`${itemId}\` supprimé du catalogue.` });
    }
    
    // ─── EDITARTICLE ──────────────────────────────────────────────────────────
    if (commandName === 'editarticle') {
      const itemId = options.getString('id');
      const prix = options.getInteger('prix');
      const description = options.getString('description');
      const categorie = options.getString('categorie');
      
      const update = {};
      if (prix !== null) update['items.$.prix'] = prix;
      if (description) update['items.$.description'] = description;
      if (categorie) update['items.$.categorie'] = categorie;
      
      if (Object.keys(update).length === 0) {
        return interaction.editReply({ content: '❌ Aucune modification spécifiée.' });
      }
      
      const result = await col('shop').updateOne(
        { guildId: guild.id, 'items.id': itemId },
        { $set: update }
      );
      
      if (result.modifiedCount === 0) {
        return interaction.editReply({ content: '❌ Article introuvable.' });
      }
      
      await interaction.editReply({ content: `✅ Article \`${itemId}\` modifié !` });
    }
    
  } catch (error) {
    console.error('Erreur interaction:', error);
    await interaction.editReply({ content: '❌ Une erreur est survenue.' }).catch(() => {});
  }
});

// ─── Button Handler ───────────────────────────────────────────────────────────
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  
  if (interaction.customId === 'cancel_order') {
    await interaction.update({ content: '❌ Commande annulée.', embeds: [], components: [] });
  }
  
  if (interaction.customId.startsWith('confirm_order_')) {
    const parts = interaction.customId.split('_');
    const itemId = parts[2];
    const quantite = parseInt(parts[3]);
    const detailsEncoded = parts[4];
    const details = detailsEncoded === 'none' ? '' : decodeURIComponent(detailsEncoded);
    
    const shopData = await col('shop').findOne({ guildId: interaction.guild.id });
    const item = shopData?.items?.find(i => i.id === itemId);
    
    if (!item) {
      return interaction.update({ content: '❌ Article introuvable.', embeds: [], components: [] });
    }
    
    const orderId = generateOrderId();
    
    const order = {
      guildId: interaction.guild.id,
      orderId,
      userId: interaction.user.id,
      userTag: interaction.user.tag,
      items: [{ itemId: item.id, nom: item.nom, quantite }],
      details: details || null,
      status: 'en_attente',
      createdAt: new Date().toISOString()
    };
    
    await col('orders').insertOne(order);
    
    const webhookEmbed = new EmbedBuilder()
      .setTitle('🛒 Nouvelle commande')
      .setColor(0xFEE75C)
      .setDescription(`**${orderId}** en attente de validation`)
      .addFields(
        { name: '👤 Client', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true },
        { name: '🛒 Articles', value: `${quantite}x ${item.nom}`, inline: true }
      )
      .setTimestamp();
    
    if (details) {
      webhookEmbed.addFields({ name: '📝 Détails', value: details });
    }
    
    await sendWebhook(webhookEmbed);
    
    const embed = new EmbedBuilder()
      .setTitle('✅ Commande enregistrée !')
      .setColor(0x57F287)
      .setDescription(`Votre commande **${orderId}** est en attente de validation.\n\n**${quantite}x ${item.nom}**`);
    
    if (details) {
      embed.addFields({ name: '📝 Détails fournis', value: details });
    }
    
    embed.setFooter({ text: 'Vous serez notifié par MP dès que votre commande sera traitée.' });
    
    await interaction.update({ embeds: [embed], components: [] });
  }
});

// ─── Express API ──────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Non autorisé' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Token invalide' }); }
}

// Auth
app.post('/api/auth/register', async (req, res) => {
  const { username, password, guildId } = req.body;
  if (!username || !password || !guildId) return res.status(400).json({ error: 'Champs manquants' });
  const existing = await col('users').findOne({ guildId, username });
  if (existing) return res.status(409).json({ error: 'Utilisateur existant' });
  const hashedPwd = await bcrypt.hash(password, 10);
  const user = { id: uuidv4(), username, password: hashedPwd, guildId, role: 'staff', createdAt: new Date().toISOString() };
  await col('users').insertOne(user);
  const token = jwt.sign({ id: user.id, username, guildId, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, username, role: user.role } });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password, guildId } = req.body;
  const user = await col('users').findOne({ guildId, username });
  if (!user || !await bcrypt.compare(password, user.password)) return res.status(401).json({ error: 'Identifiants incorrects' });
  const token = jwt.sign({ id: user.id, username, guildId, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, username, role: user.role } });
});

// Orders (Staff)
app.get('/api/orders', authMiddleware, async (req, res) => {
  const orders = await col('orders').find({ guildId: req.user.guildId }).sort({ createdAt: -1 }).toArray();
  res.json(orders);
});

app.patch('/api/orders/:orderId', authMiddleware, async (req, res) => {
  const { status, raisonRefus } = req.body;
  const update = { status };
  if (raisonRefus) update.raisonRefus = raisonRefus;
  if (status === 'validee' || status === 'refusee') {
    update.staffId = req.user.id;
    update.staffTag = req.user.username;
    update.validatedAt = new Date().toISOString();
  }
  if (status === 'livree') {
    update.deliveredAt = new Date().toISOString();
  }
  await col('orders').updateOne({ guildId: req.user.guildId, orderId: req.params.orderId }, { $set: update });
  res.json({ success: true });
});

// Shop (Staff)
app.get('/api/shop', authMiddleware, async (req, res) => {
  const shop = await col('shop').findOne({ guildId: req.user.guildId });
  res.json(shop?.items || []);
});

app.post('/api/shop', authMiddleware, async (req, res) => {
  const item = { ...req.body, id: req.body.nom.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + uuidv4().slice(0, 4), createdAt: new Date().toISOString() };
  await col('shop').updateOne({ guildId: req.user.guildId }, { $push: { items: item } }, { upsert: true });
  res.json(item);
});

app.patch('/api/shop/:itemId', authMiddleware, async (req, res) => {
  const { prix, description, categorie } = req.body;
  const update = {};
  if (prix !== undefined) update['items.$.prix'] = prix;
  if (description !== undefined) update['items.$.description'] = description;
  if (categorie !== undefined) update['items.$.categorie'] = categorie;
  
  await col('shop').updateOne(
    { guildId: req.user.guildId, 'items.id': req.params.itemId },
    { $set: update }
  );
  res.json({ success: true });
});

app.delete('/api/shop/:itemId', authMiddleware, async (req, res) => {
  await col('shop').updateOne({ guildId: req.user.guildId }, { $pull: { items: { id: req.params.itemId } } });
  res.json({ success: true });
});

// API Publique (Joueurs)
app.get('/api/public/shop/:guildId', async (req, res) => {
  const { guildId } = req.params;
  const shop = await col('shop').findOne({ guildId });
  res.json(shop?.items || []);
});

app.get('/api/public/orders/:userId', async (req, res) => {
  const { userId } = req.params;
  const { guild } = req.query;
  if (!guild) return res.status(400).json({ error: 'Guild ID requis' });
  const orders = await col('orders').find({ guildId: guild, userId }).sort({ createdAt: -1 }).limit(30).toArray();
  res.json(orders);
});

app.post('/api/public/orders', async (req, res) => {
  const { guildId, userId, items, details } = req.body;
  if (!guildId || !userId || !items || items.length === 0) {
    return res.status(400).json({ error: 'Données manquantes' });
  }
  const orderId = generateOrderId();
  const order = { guildId, orderId, userId, userTag: userId, items, details: details || null, status: 'en_attente', createdAt: new Date().toISOString() };
  await col('orders').insertOne(order);
  if (ORDER_WEBHOOK) {
    try {
      const embed = new EmbedBuilder().setTitle('🛒 Nouvelle commande (Site)').setColor(0xFEE75C).setDescription(`**${orderId}** en attente`).addFields({ name: '👤 ID Discord', value: userId }, { name: '🛒 Articles', value: items.map(i => `${i.quantite}x ${i.nom}`).join('\n') }).setTimestamp();
      if (details) embed.addFields({ name: '📝 Détails', value: details });
      await fetch(ORDER_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ embeds: [embed.toJSON()] }) });
    } catch (e) {}
  }
  res.json({ success: true, orderId });
});

// Catch-all
app.get('*', (req, res) => {
  if (req.path === '/joueur' || req.path.startsWith('/joueur')) {
    res.sendFile(path.join(__dirname, 'public', 'joueur.html'));
  } else {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
async function start() {
  await connectDB();
  app.listen(PORT, () => console.log(`🌐 Panel Vendeur: ${PANEL_URL}`));
  await client.login(BOT_TOKEN);
}

start();
