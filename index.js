const { Telegraf } = require('telegraf');
const axios = require('axios');
const ipaInfo = require('ipa-extract-info');
const http = require('http');

const bot = new Telegraf(process.env.BOT_TOKEN);

// Cấu hình GitHub của bạn
const GH_CONFIG = {
    owner: 'haduongyenn-ui',
    repo: 'haduongyenn-ui.github.io',
    token: process.env.GH_TOKEN
};

bot.on('text', async (ctx) => {
    const url = ctx.message.text.trim();
    if (!url.startsWith('http')) return;

    const statusMsg = await ctx.reply('⏳ Đang xử lý file IPA...');

    try {
        const res = await axios.get(url, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(res.data);
        const info = await ipaInfo(buffer);

        const appName = info.content['CFBundleDisplayName'] || info.content['CFBundleName'] || 'Unknown';
        const bundleId = info.content['CFBundleIdentifier'];
        const version = info.content['CFBundleShortVersionString'];
        const fileName = `${Date.now()}.ipa`;

        // Upload IPA
        await axios.put(`https://api.github.com/repos/${GH_CONFIG.owner}/${GH_CONFIG.repo}/contents/IPA/${fileName}`, 
            { message: `Upload ${appName}`, content: buffer.toString('base64') },
            { headers: { Authorization: `Bearer ${GH_CONFIG.token}` } }
        );

        // Tạo nội dung Plist để cài trực tiếp
        const plistContent = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>items</key><array><dict><key>assets</key><array><dict><key>kind</key><string>software-package</string><key>url</key><string>https://${GH_CONFIG.owner}.github.io/IPA/${fileName}</string></dict></array><key>metadata</key><dict><key>bundle-identifier</key><string>${bundleId}</string><key>bundle-version</key><string>${version}</string><key>kind</key><string>software</string><key>title</key><string>${appName}</string></dict></dict></array></dict></plist>`).toString('base64');

        // Upload Plist
        await axios.put(`https://api.github.com/repos/${GH_CONFIG.owner}/${GH_CONFIG.repo}/contents/Plist/${fileName.replace('.ipa', '.plist')}`, 
            { message: `Create Plist ${appName}`, content: plistContent },
            { headers: { Authorization: `Bearer ${GH_CONFIG.token}` } }
        );

        ctx.replyWithMarkdown(`✅ **Upload hoàn tất!**\n\n📱 **Ứng dụng:** ${appName}\n🆔 **Bundle:** ${bundleId}\n🔢 **Phiên bản:** ${version}\n\n📦 **Tải IPA:**\nhttps://${GH_CONFIG.owner}.github.io/IPA/${fileName}\n\n📲 **Cài trực tiếp:**\n\`itms-services://?action=download-manifest&url=https://${GH_CONFIG.owner}.github.io/Plist/${fileName.replace('.ipa', '.plist')}\``);
    } catch (e) {
        ctx.reply('❌ Lỗi: ' + e.message);
    }
});

// Giữ cho Koyeb không báo lỗi Health Check
http.createServer((req, res) => { res.end('Bot is Live!'); }).listen(process.env.PORT || 8080);

bot.launch();
console.log("Bot đã chạy...");
