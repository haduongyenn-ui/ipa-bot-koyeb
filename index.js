const { Telegraf } = require('telegraf');
const axios = require('axios');
const AdmZip = require('adm-zip'); 
const http = require('http');

const bot = new Telegraf(process.env.BOT_TOKEN);

const GH_CONFIG = {
    owner: 'haduongyenn-ui',
    repo: 'haduongyenn-ui.github.io',
    token: process.env.GH_TOKEN
};

// ============================================================
// 👇👇 CẤU HÌNH TÊN MIỀN & THƯ MỤC CỦA BẠN 👇👇
const CUSTOM_DOMAIN = 'https://download.khoindvn.io.vn'; // Tên miền riêng
const FOLDER_NAME = 'iPA';    // Tên thư mục chứa IPA (viết hoa/thường phải chuẩn)
const PLIST_FOLDER = 'Plist'; // Tên thư mục chứa Plist
// ============================================================

function sanitizeName(name) {
    return name.replace(/[^a-zA-Z0-9]/g, "_");
}

function parseIpa(buffer) {
    try {
        const zip = new AdmZip(buffer);
        const zipEntries = zip.getEntries();
        let appInfo = { name: 'Unknown', bundle: 'Unknown', version: '1.0', team: 'Unknown' };

        const infoPlistEntry = zipEntries.find(entry => entry.entryName.match(/^Payload\/[^/]+\.app\/Info\.plist$/));
        if (infoPlistEntry) {
            const content = zip.readAsText(infoPlistEntry);
            const getValue = (key) => {
                const match = content.match(new RegExp(`<key>${key}<\\/key>\\s*<string>([^<]+)<\\/string>`));
                return match ? match[1] : null;
            };
            appInfo.name = getValue('CFBundleDisplayName') || getValue('CFBundleName') || 'App';
            appInfo.bundle = getValue('CFBundleIdentifier') || 'com.unknown';
            appInfo.version = getValue('CFBundleShortVersionString') || '1.0';
        }

        const provisionEntry = zipEntries.find(entry => entry.entryName.includes('embedded.mobileprovision'));
        if (provisionEntry) {
            const content = zip.readAsText(provisionEntry);
            const teamMatch = content.match(/<key>TeamName<\/key>\s*<string>([^<]+)<\/string>/);
            if (teamMatch) appInfo.team = teamMatch[1];
        }
        return appInfo;
    } catch (e) {
        return { name: 'Error', bundle: 'Error', version: '0.0', team: 'Unknown' };
    }
}

async function processIpa(ctx, url, fileNameInput) {
    const initialMsg = await ctx.reply(`📥 **Bot đã nhận file!**\nĐang tải về...`, { parse_mode: 'Markdown' });
    const msgId = initialMsg.message_id;
    const chatId = ctx.chat.id;
    let lastUpdate = 0;

    const updateProgress = async (text) => {
        const now = Date.now();
        if (now - lastUpdate > 2000 || text.includes('✅')) { 
            try { await ctx.telegram.editMessageText(chatId, msgId, undefined, text, { parse_mode: 'Markdown' }); lastUpdate = now; } catch (e) {} 
        }
    };

    try {
        const res = await axios.get(url, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(res.data);
        
        await updateProgress(`⚙️ **Đang phân tích file...**`);
        const info = parseIpa(buffer);
        
        const safeName = sanitizeName(info.name);
        const newFileName = `${safeName}_v${sanitizeName(info.version)}_${Date.now()}.ipa`;

        // Đường dẫn tương đối trên GitHub
        const ipaPath = `${FOLDER_NAME}/${newFileName}`;
        const plistPath = `${PLIST_FOLDER}/${newFileName.replace('.ipa', '.plist')}`;
        
        // Link Direct sử dụng tên miền riêng của bạn
        const ipaDirectLink = `${CUSTOM_DOMAIN}/${ipaPath}`;
        const plistDirectLink = `${CUSTOM_DOMAIN}/${plistPath}`;

        await updateProgress(`⬆️ **Đang upload lên ${CUSTOM_DOMAIN}...**`);

        // Upload IPA
        await axios.put(`https://api.github.com/repos/${GH_CONFIG.owner}/${GH_CONFIG.repo}/contents/${ipaPath}`, 
            { message: `Upload ${info.name}`, content: buffer.toString('base64') },
            { headers: { Authorization: `Bearer ${GH_CONFIG.token}` }, maxBodyLength: Infinity, maxContentLength: Infinity }
        );

        // Upload Plist (nội dung plist trỏ về tên miền riêng)
        const plistContent = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>items</key><array><dict><key>assets</key><array><dict><key>kind</key><string>software-package</string><key>url</key><string>${ipaDirectLink}</string></dict></array><key>metadata</key><dict><key>bundle-identifier</key><string>${info.bundle}</string><key>bundle-version</key><string>${info.version}</string><key>kind</key><string>software</string><key>title</key><string>${info.name}</string></dict></dict></array></dict></plist>`).toString('base64');

        await axios.put(`https://api.github.com/repos/${GH_CONFIG.owner}/${GH_CONFIG.repo}/contents/${plistPath}`, 
            { message: `Create Plist ${info.name}`, content: plistContent },
            { headers: { Authorization: `Bearer ${GH_CONFIG.token}` } }
        );

        const finalMsg = `✅ **Upload hoàn tất!**\n\n📁 **Vị trí:** \`${ipaPath}\`\n📱 **App:** ${info.name}\n🆔 **Bundle:** ${info.bundle}\n🔢 **Ver:** ${info.version}\n👥 **Team:** ${info.team}\n\n📦 **Link tải:**\n${ipaDirectLink}\n\n📲 **Cài trực tiếp:**\n\`itms-services://?action=download-manifest&url=${plistDirectLink}\``;
        await ctx.telegram.editMessageText(chatId, msgId, undefined, finalMsg, { parse_mode: 'Markdown', disable_web_page_preview: true });

    } catch (e) {
        await updateProgress(`❌ **Lỗi:** ${e.message}`);
    }
}

bot.on('document', async (ctx) => {
    const doc = ctx.message.document;
    if (!doc.file_name.toLowerCase().endsWith('.ipa')) return ctx.reply('⚠️ Chỉ nhận file .ipa');
    if (doc.file_size > 20 * 1024 * 1024) return ctx.reply('❌ File > 20MB. Vui lòng gửi Link.');
    const link = await ctx.telegram.getFileLink(doc.file_id);
    await processIpa(ctx, link.href, doc.file_name);
});

bot.on('text', async (ctx) => {
    if (ctx.message.text.startsWith('http')) await processIpa(ctx, ctx.message.text, 'URL');
});

http.createServer((req, res) => res.end('Bot Alive')).listen(process.env.PORT || 8080);
bot.launch();
