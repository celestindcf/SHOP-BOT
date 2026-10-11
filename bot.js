const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, PermissionFlagsBits, REST, Routes } = require('discord.js');
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

const GUILD_ID = '1495077016515514408';

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
  if (!collectionNames.includes('dealers')) await db.createCollection('dealers');
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
  try { await fetch(ORDER_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ embeds: [embed] }) }); } catch (e) {}
}
function slugify(str) { return str.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''); }

// ─── Slash Commands ───────────────────────────────────────────────────────────
const commands = [
  new SlashCommandBuilder().setName('catalogue').setDescription('Voir le catalogue').addStringOption(o => o.setName('categorie').setDescription('Filtrer').setRequired(false)).addStringOption(o => o.setName('type').setDescription('Type').setRequired(false).addChoices({ name: 'Articles', value: 'item' }, { name: 'Voitures', value: 'voiture' }, { name: 'Accessoires', value: 'accessoire' })),
  new SlashCommandBuilder().setName('commander').setDescription('Passer une commande').addStringOption(o => o.setName('article').setDescription('Nom ou ID').setRequired(true)).addIntegerOption(o => o.setName('quantite').setDescription('Quantité').setRequired(false)).addStringOption(o => o.setName('details').setDescription('Précisions').setRequired(false)).addStringOption(o => o.setName('flocage').setDescription('URL image flocage').setRequired(false)),
  new SlashCommandBuilder().setName('mescommandes').setDescription('Voir vos commandes'),
  new SlashCommandBuilder().setName('concessions').setDescription('Voir les concessionnaires disponibles'),
  new SlashCommandBuilder().setName('validercommande').setDescription('[VENDEUR] Valider').addStringOption(o => o.setName('id').setDescription('ID commande').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  new SlashCommandBuilder().setName('refusercommande').setDescription('[VENDEUR] Refuser').addStringOption(o => o.setName('id').setDescription('ID commande').setRequired(true)).addStringOption(o => o.setName('raison').setDescription('Raison').setRequired(false)).setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  new SlashCommandBuilder().setName('livrercommande').setDescription('[VENDEUR] Livrer').addStringOption(o => o.setName('id').setDescription('ID commande').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  new SlashCommandBuilder().setName('panelvendeur').setDescription('[VENDEUR] Lien panel'),
  new SlashCommandBuilder().setName('addarticle').setDescription('[ADMIN] Ajouter un article').addStringOption(o => o.setName('nom').setDescription('Nom').setRequired(true)).addStringOption(o => o.setName('categorie').setDescription('Catégorie').setRequired(true)).addIntegerOption(o => o.setName('prix').setDescription('Prix').setRequired(false)).addStringOption(o => o.setName('description').setDescription('Description').setRequired(false)).addStringOption(o => o.setName('image').setDescription('URL image').setRequired(false)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('addvoiture').setDescription('[ADMIN] Ajouter une voiture').addStringOption(o => o.setName('nom').setDescription('Nom').setRequired(true)).addStringOption(o => o.setName('categorie').setDescription('Catégorie').setRequired(true)).addIntegerOption(o => o.setName('prix').setDescription('Prix').setRequired(false)).addStringOption(o => o.setName('description').setDescription('Description').setRequired(false)).addStringOption(o => o.setName('image').setDescription('URL image').setRequired(false)).addStringOption(o => o.setName('pack').setDescription('Pack inclus (séparés par virgule)').setRequired(false)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('addaccessoire').setDescription('[ADMIN] Ajouter un accessoire').addStringOption(o => o.setName('nom').setDescription('Nom').setRequired(true)).addStringOption(o => o.setName('categorie').setDescription('Catégorie').setRequired(true)).addIntegerOption(o => o.setName('prix').setDescription('Prix').setRequired(false)).addStringOption(o => o.setName('description').setDescription('Description').setRequired(false)).addStringOption(o => o.setName('image').setDescription('URL image').setRequired(false)).addStringOption(o => o.setName('flocage').setDescription('URL flocage').setRequired(false)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('addconcession').setDescription('[ADMIN] Ajouter un concessionnaire').addStringOption(o => o.setName('nom').setDescription('Nom').setRequired(true)).addStringOption(o => o.setName('adresse').setDescription('Adresse / Localisation').setRequired(false)).addStringOption(o => o.setName('image').setDescription('URL image').setRequired(false)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('removearticle').setDescription('[ADMIN] Supprimer un article/voiture/accessoire').addStringOption(o => o.setName('id').setDescription('ID').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('removeconcession').setDescription('[ADMIN] Supprimer un concessionnaire').addStringOption(o => o.setName('id').setDescription('ID concession').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('editarticle').setDescription('[ADMIN] Modifier un article').addStringOption(o => o.setName('id').setDescription('ID').setRequired(true)).addIntegerOption(o => o.setName('prix').setDescription('Prix').setRequired(false)).addStringOption(o => o.setName('description').setDescription('Description').setRequired(false)).addStringOption(o => o.setName('categorie').setDescription('Catégorie').setRequired(false)).addStringOption(o => o.setName('pack').setDescription('Pack').setRequired(false)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
];

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
  try { await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands.map(c => c.toJSON()) }); console.log('✅ Commandes enregistrées'); } catch (e) { console.error(e); }
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
      const typeFilter = options.getString('type');
      const allItems = (await col('shop').findOne({ guildId: guild.id }))?.items || [];
      let filtered = allItems;
      if (categorie) filtered = filtered.filter(i => i.categorie?.toLowerCase() === categorie.toLowerCase());
      if (typeFilter) filtered = filtered.filter(i => (i.type || 'item') === typeFilter);
      if (!filtered.length) return interaction.editReply({ content: '❌ Aucun article.' });
      const byCat = {}; filtered.forEach(i => { const c = i.categorie || 'Autre'; if (!byCat[c]) byCat[c] = []; byCat[c].push(i); });
      const embed = new EmbedBuilder().setTitle('🏪 Catalogue').setColor(0x57F287);
      for (const [cat, catItems] of Object.entries(byCat)) {
        const lines = catItems.map(i => {
          let line = `**${i.nom}**${i.prix ? ` — ${i.prix}💰` : ''}\n> \`${i.id}\``;
          if (i.pack?.length) line += `\n> 📦 Pack: ${i.pack.join(', ')}`;
          if (i.dealers?.length) line += `\n> 🏢 Concessions: ${i.dealers.length}`;
          if (i.description) line += `\n> ${i.description}`;
          return line;
        }).join('\n\n');
        embed.addFields({ name: `📦 ${cat}`, value: lines.slice(0, 1024) });
      }
      await interaction.editReply({ embeds: [embed] });
    }
    
    if (commandName === 'concessions') {
      const dealers = await col('dealers').find({ guildId: guild.id }).toArray();
      if (!dealers.length) return interaction.editReply({ content: '❌ Aucun concessionnaire.' });
      const embed = new EmbedBuilder().setTitle('🏢 Concessionnaires').setColor(0x5865F2);
      dealers.forEach(d => {
        let val = d.adresse ? `📍 ${d.adresse}\n` : '';
        val += `\`${d.id}\``;
        embed.addFields({ name: `🏢 ${d.nom}`, value: val });
      });
      await interaction.editReply({ embeds: [embed] });
    }
    
    if (commandName === 'commander') {
      const query = options.getString('article').toLowerCase();
      const qte = options.getInteger('quantite') || 1;
      const details = options.getString('details') || '';
      const flocage = options.getString('flocage') || '';
      const item = (await col('shop').findOne({ guildId: guild.id }))?.items?.find(i => i.id.toLowerCase() === query || i.nom.toLowerCase().includes(query));
      if (!item) return interaction.editReply({ content: '❌ Introuvable.' });
      
      // Si voiture : on doit choisir un concessionnaire
      let dealer = null;
      if (item.type === 'voiture' && item.dealers?.length) {
        const dealers = await col('dealers').find({ guildId: guild.id, id: { $in: item.dealers } }).toArray();
        if (!dealers.length) return interaction.editReply({ content: '❌ Aucun concessionnaire ne vend cette voiture.' });
        const select = new StringSelectMenuBuilder()
          .setCustomId(`select_dealer_${item.id}_${qte}_${details ? encodeURIComponent(details) : 'none'}_${flocage ? encodeURIComponent(flocage) : 'none'}`)
          .setPlaceholder('Choisissez un concessionnaire')
          .addOptions(dealers.slice(0, 25).map(d => ({ label: d.nom, value: d.id, description: d.adresse || undefined })));
        const row = new ActionRowBuilder().addComponents(select);
        return interaction.editReply({ content: `🏢 **Choisissez le concessionnaire pour ${item.nom}** :`, components: [row] });
      }
      
      const embed = new EmbedBuilder().setTitle('🛒 Confirmation').setColor(0xFEE75C).setDescription(`**${qte}x ${item.nom}**`).setFooter({ text: '✅ Confirmer' });
      if (item.prix) embed.addFields({ name: '💰', value: `${item.prix} 💰`, inline: true });
      if (item.pack?.length) embed.addFields({ name: '📦 Pack inclus', value: item.pack.join(', ') });
      if (details) embed.addFields({ name: '📝', value: details });
      if (flocage) embed.setImage(flocage);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`confirm_${item.id}_${qte}_${details ? encodeURIComponent(details) : 'none'}_${flocage ? encodeURIComponent(flocage) : 'none'}_none`).setLabel('✅').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('cancel_order').setLabel('❌').setStyle(ButtonStyle.Danger)
      );
      await interaction.editReply({ embeds: [embed], components: [row] });
    }
    
    if (commandName === 'mescommandes') {
      const orders = await col('orders').find({ guildId: guild.id, userId: user.id }).sort({ createdAt: -1 }).limit(10).toArray();
      if (!orders.length) return interaction.editReply({ content: '📭 Aucune commande.' });
      const embed = new EmbedBuilder().setTitle(`📋 ${user.username}`).setColor(0x5865F2);
      const st = { 'en_attente': '🟡 En attente', 'validee': '🟢 Validée', 'livree': '✅ Livrée', 'refusee': '🔴 Refusée' };
      orders.forEach(o => embed.addFields({ name: `${o.orderId} — ${st[o.status] || o.status}`, value: `${o.items.map(i => `${i.quantite}x ${i.nom}`).join('\n')}${o.dealerNom ? `\n🏢 ${o.dealerNom}` : ''}${o.details ? `\n📝 ${o.details}` : ''}` }));
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
      const item = { id: slugify(options.getString('nom')) + '-' + uuidv4().slice(0,4), nom: options.getString('nom'), categorie: options.getString('categorie'), type: 'item', description: options.getString('description') || '', image: options.getString('image') || '', createdAt: new Date().toISOString(), prix: options.getInteger('prix') || null };
      await col('shop').updateOne({ guildId: guild.id }, { $push: { items: item } }, { upsert: true });
      await interaction.editReply({ content: `✅ ${item.nom} ajouté (ID: \`${item.id}\`)` });
    }
    
    if (commandName === 'addvoiture') {
      const packStr = options.getString('pack') || '';
      const pack = packStr ? packStr.split(',').map(s => s.trim()).filter(Boolean) : [];
      const item = { id: slugify(options.getString('nom')) + '-' + uuidv4().slice(0,4), nom: options.getString('nom'), categorie: options.getString('categorie'), type: 'voiture', description: options.getString('description') || '', image: options.getString('image') || '', pack, dealers: [], flocageImage: '', createdAt: new Date().toISOString(), prix: options.getInteger('prix') || null };
      await col('shop').updateOne({ guildId: guild.id }, { $push: { items: item } }, { upsert: true });
      await interaction.editReply({ content: `🚗 ${item.nom} ajoutée (ID: \`${item.id}\`)\n⚠️ Ajoute les concessions via le panel vendeur.` });
    }
    
    if (commandName === 'addaccessoire') {
      const item = { id: slugify(options.getString('nom')) + '-' + uuidv4().slice(0,4), nom: options.getString('nom'), categorie: options.getString('categorie'), type: 'accessoire', description: options.getString('description') || '', image: options.getString('image') || '', flocageImage: options.getString('flocage') || '', createdAt: new Date().toISOString(), prix: options.getInteger('prix') || null };
      await col('shop').updateOne({ guildId: guild.id }, { $push: { items: item } }, { upsert: true });
      await interaction.editReply({ content: `🔧 ${item.nom} ajouté (ID: \`${item.id}\`)` });
    }
    
    if (commandName === 'addconcession') {
      const dealer = { id: slugify(options.getString('nom')) + '-' + uuidv4().slice(0,4), nom: options.getString('nom'), adresse: options.getString('adresse') || '', image: options.getString('image') || '', createdAt: new Date().toISOString() };
      await col('dealers').insertOne({ guildId: guild.id, ...dealer });
      await interaction.editReply({ content: `🏢 ${dealer.nom} ajouté (ID: \`${dealer.id}\`)` });
    }
    
    if (commandName === 'removearticle') {
      const r = await col('shop').updateOne({ guildId: guild.id }, { $pull: { items: { id: options.getString('id') } } });
      if (!r.modifiedCount) return interaction.editReply({ content: '❌ Introuvable.' });
      await interaction.editReply({ content: '✅ Supprimé.' });
    }
    
    if (commandName === 'removeconcession') {
      const r = await col('dealers').deleteOne({ guildId: guild.id, id: options.getString('id') });
      if (!r.deletedCount) return interaction.editReply({ content: '❌ Introuvable.' });
      await interaction.editReply({ content: '✅ Concession supprimée.' });
    }
    
    if (commandName === 'editarticle') {
      const upd = {};
      if (options.getInteger('prix') !== null) upd['items.$.prix'] = options.getInteger('prix');
      if (options.getString('description')) upd['items.$.description'] = options.getString('description');
      if (options.getString('categorie')) upd['items.$.categorie'] = options.getString('categorie');
      if (options.getString('pack') !== null) { const p = options.getString('pack'); upd['items.$.pack'] = p ? p.split(',').map(s => s.trim()).filter(Boolean) : []; }
      const r = await col('shop').updateOne({ guildId: guild.id, 'items.id': options.getString('id') }, { $set: upd });
      if (!r.modifiedCount) return interaction.editReply({ content: '❌ Introuvable.' });
      await interaction.editReply({ content: '✅ Modifié.' });
    }
  } catch (e) { console.error(e); await interaction.editReply({ content: '❌ Erreur.' }).catch(() => {}); }
});

// ─── Buttons & Select Menus ───────────────────────────────────────────────────
client.on('interactionCreate', async interaction => {
  // Select concessionnaire
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('select_dealer_')) {
    const parts = interaction.customId.split('_');
    // select_dealer_<itemId>_<qte>_<details>_<flocage>
    const itemId = parts[2];
    const qte = parts[3];
    const det = parts[4];
    const floc = parts[5];
    const dealerId = interaction.values[0];
    const details = det === 'none' ? '' : decodeURIComponent(det);
    const flocage = floc === 'none' ? '' : decodeURIComponent(floc);
    
    const shopDoc = await col('shop').findOne({ guildId: interaction.guild.id });
    const item = shopDoc?.items?.find(i => i.id === itemId);
    if (!item) return interaction.update({ content: '❌ Article introuvable.', components: [] });
    
    const dealer = await col('dealers').findOne({ guildId: interaction.guild.id, id: dealerId });
    if (!dealer) return interaction.update({ content: '❌ Concession introuvable.', components: [] });
    
    const embed = new EmbedBuilder().setTitle('🛒 Confirmation').setColor(0xFEE75C)
      .setDescription(`**${qte}x ${item.nom}**\n🏢 Concession : **${dealer.nom}**${dealer.adresse ? `\n📍 ${dealer.adresse}` : ''}`)
      .setFooter({ text: '✅ Confirmer' });
    if (item.prix) embed.addFields({ name: '💰', value: `${item.prix} 💰`, inline: true });
    if (item.pack?.length) embed.addFields({ name: '📦 Pack inclus', value: item.pack.join(', ') });
    if (details) embed.addFields({ name: '📝', value: details });
    if (flocage) embed.setImage(flocage);
    
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`confirm_${item.id}_${qte}_${det}_${floc}_${dealer.id}`).setLabel('✅ Confirmer').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('cancel_order').setLabel('❌ Annuler').setStyle(ButtonStyle.Danger)
    );
    await interaction.update({ content: null, embeds: [embed], components: [row] });
    return;
  }
  
  if (!interaction.isButton()) return;
  if (interaction.customId === 'cancel_order') return interaction.update({ content: '❌ Annulé.', embeds: [], components: [] });
  
  if (interaction.customId.startsWith('confirm_')) {
    const parts = interaction.customId.split('_');
    const id = parts[1];
    const qte = parts[2];
    const det = parts[3];
    const floc = parts[4];
    const dealerId = parts[5];
    const details = det === 'none' ? '' : decodeURIComponent(det);
    const flocage = floc === 'none' ? '' : decodeURIComponent(floc);
    const item = (await col('shop').findOne({ guildId: interaction.guild.id }))?.items?.find(i => i.id === id);
    if (!item) return interaction.update({ content: '❌ Introuvable.', embeds: [], components: [] });
    
    let dealerNom = null, dealerIdFinal = null;
    if (dealerId && dealerId !== 'none') {
      const d = await col('dealers').findOne({ guildId: interaction.guild.id, id: dealerId });
      if (d) { dealerNom = d.nom; dealerIdFinal = d.id; }
    }
    
    const order = {
      guildId: interaction.guild.id,
      orderId: generateOrderId(),
      userId: interaction.user.id,
      userTag: interaction.user.tag,
      items: [{ itemId: item.id, nom: item.nom, quantite: parseInt(qte), type: item.type || 'item', pack: item.pack || [] }],
      details, flocage,
      dealerId: dealerIdFinal,
      dealerNom,
      status: 'en_attente',
      createdAt: new Date().toISOString()
    };
    await col('orders').insertOne(order);
    
    const fields = [{ name: '👤', value: `<@${interaction.user.id}>` }, { name: '🛒', value: `${qte}x ${item.nom}` }];
    if (dealerNom) fields.push({ name: '🏢', value: dealerNom });
    await sendWebhook(new EmbedBuilder().setTitle('🛒 Nouvelle commande').setColor(0xFEE75C).setDescription(`**${order.orderId}**`).addFields(fields));
    
    await interaction.update({ embeds: [new EmbedBuilder().setTitle('✅ Enregistrée').setColor(0x57F287).setDescription(`**${order.orderId}**\n${qte}x ${item.nom}${dealerNom ? `\n🏢 ${dealerNom}` : ''}`)], components: [] });
  }
});

// ─── Express API ──────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Orders ───
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
  if (status === 'validee' || status === 'refusee') upd.validatedAt = new Date().toISOString();
  if (status === 'livree') upd.deliveredAt = new Date().toISOString();
  await col('orders').updateOne({ guildId: guild, orderId: req.params.orderId }, { $set: upd });
  res.json({ success: true });
});

// ─── Dealers (Concessions) ───
app.get('/api/dealers', async (req, res) => {
  const { guild } = req.query;
  if (!guild) return res.status(400).json({ error: 'Guild ID requis' });
  res.json(await col('dealers').find({ guildId: guild }).sort({ createdAt: 1 }).toArray());
});

app.post('/api/dealers', async (req, res) => {
  const { guild, nom, adresse, image } = req.body;
  if (!guild || !nom) return res.status(400).json({ error: 'Nom requis' });
  const dealer = { guildId: guild, id: slugify(nom) + '-' + uuidv4().slice(0,4), nom, adresse: adresse || '', image: image || '', createdAt: new Date().toISOString() };
  await col('dealers').insertOne(dealer);
  res.json(dealer);
});

app.patch('/api/dealers/:id', async (req, res) => {
  const { guild, nom, adresse, image } = req.body;
  if (!guild) return res.status(400).json({ error: 'Guild ID requis' });
  const upd = {};
  if (nom) upd.nom = nom;
  if (adresse !== undefined) upd.adresse = adresse;
  if (image !== undefined) upd.image = image;
  await col('dealers').updateOne({ guildId: guild, id: req.params.id }, { $set: upd });
  res.json({ success: true });
});

app.delete('/api/dealers/:id', async (req, res) => {
  const { guild } = req.query;
  if (!guild) return res.status(400).json({ error: 'Guild ID requis' });
  await col('dealers').deleteOne({ guildId: guild, id: req.params.id });
  res.json({ success: true });
});

// ─── Shop ───
app.get('/api/shop', async (req, res) => {
  const { guild, type } = req.query;
  if (!guild) return res.status(400).json({ error: 'Guild ID requis' });
  let items = (await col('shop').findOne({ guildId: guild }))?.items || [];
  if (type) items = items.filter(i => (i.type || 'item') === type);
  res.json(items);
});

app.get('/api/cars', async (req, res) => {
  const { guild } = req.query;
  if (!guild) return res.status(400).json({ error: 'Guild ID requis' });
  const items = (await col('shop').findOne({ guildId: guild }))?.items || [];
  res.json(items.filter(i => i.type === 'voiture'));
});

app.get('/api/cars/accessories', async (req, res) => {
  const { guild } = req.query;
  if (!guild) return res.status(400).json({ error: 'Guild ID requis' });
  const items = (await col('shop').findOne({ guildId: guild }))?.items || [];
  res.json(items.filter(i => i.type === 'accessoire'));
});

app.post('/api/shop', async (req, res) => {
  const { guild, nom, categorie, prix, description, image, type, pack, flocageImage, dealers } = req.body;
  if (!guild || !nom || !categorie) return res.status(400).json({ error: 'Champs requis manquants' });
  const item = {
    id: slugify(nom) + '-' + uuidv4().slice(0,4),
    nom, categorie,
    type: type || 'item',
    description: description || '',
    image: image || '',
    pack: Array.isArray(pack) ? pack : (pack ? pack.split(',').map(s => s.trim()).filter(Boolean) : []),
    dealers: Array.isArray(dealers) ? dealers : [],
    flocageImage: flocageImage || '',
    prix: prix || null,
    createdAt: new Date().toISOString()
  };
  await col('shop').updateOne({ guildId: guild }, { $push: { items: item } }, { upsert: true });
  res.json(item);
});

app.patch('/api/shop/:itemId', async (req, res) => {
  const { guild, prix, description, categorie, pack, flocageImage, type, dealers } = req.body;
  if (!guild) return res.status(400).json({ error: 'Guild ID requis' });
  const upd = {};
  if (prix !== undefined) upd['items.$.prix'] = prix;
  if (description !== undefined) upd['items.$.description'] = description;
  if (categorie) upd['items.$.categorie'] = categorie;
  if (pack !== undefined) upd['items.$.pack'] = Array.isArray(pack) ? pack : (pack ? pack.split(',').map(s => s.trim()).filter(Boolean) : []);
  if (flocageImage !== undefined) upd['items.$.flocageImage'] = flocageImage;
  if (type) upd['items.$.type'] = type;
  if (dealers !== undefined) upd['items.$.dealers'] = Array.isArray(dealers) ? dealers : [];
  await col('shop').updateOne({ guildId: guild, 'items.id': req.params.itemId }, { $set: upd });
  res.json({ success: true });
});

app.delete('/api/shop/:itemId', async (req, res) => {
  const { guild } = req.query;
  if (!guild) return res.status(400).json({ error: 'Guild ID requis' });
  await col('shop').updateOne({ guildId: guild }, { $pull: { items: { id: req.params.itemId } } });
  res.json({ success: true });
});

// ─── API publique joueurs ───
app.get('/api/public/shop/:guildId', async (req, res) => {
  const { type } = req.query;
  let items = (await col('shop').findOne({ guildId: req.params.guildId }))?.items || [];
  if (type) items = items.filter(i => (i.type || 'item') === type);
  res.json(items);
});

app.get('/api/public/dealers/:guildId', async (req, res) => {
  res.json(await col('dealers').find({ guildId: req.params.guildId }).sort({ createdAt: 1 }).toArray());
});

app.get('/api/public/orders/:userId', async (req, res) => {
  const { guild } = req.query;
  if (!guild) return res.status(400).json({ error: 'Guild ID requis' });
  res.json(await col('orders').find({ guildId: guild, userId: req.params.userId }).sort({ createdAt: -1 }).limit(30).toArray());
});

app.post('/api/public/orders', async (req, res) => {
  const { guildId, userId, items, details, flocage, dealerId } = req.body;
  if (!guildId || !userId || !items?.length) return res.status(400).json({ error: 'Données manquantes' });
  
  let dealerNom = null;
  if (dealerId) {
    const d = await col('dealers').findOne({ guildId, id: dealerId });
    if (d) dealerNom = d.nom;
  }
  
  const order = {
    guildId, orderId: generateOrderId(), userId, userTag: userId,
    items, details, flocage: flocage || '',
    dealerId: dealerId || null, dealerNom,
    status: 'en_attente', createdAt: new Date().toISOString()
  };
  await col('orders').insertOne(order);
  
  if (ORDER_WEBHOOK) {
    try {
      const fields = [{ name: '👤', value: userId }, { name: '🛒', value: items.map(i => `${i.quantite}x ${i.nom}`).join('\n') }];
      if (dealerNom) fields.push({ name: '🏢', value: dealerNom });
      if (details) fields.push({ name: '📝', value: details });
      const embed = new EmbedBuilder().setTitle('🛒 Nouvelle commande (Site)').setColor(0xFEE75C).setDescription(`**${order.orderId}**`).addFields(fields);
      if (flocage) embed.setImage(flocage);
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
