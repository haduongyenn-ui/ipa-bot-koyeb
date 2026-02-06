const { Telegraf } = require('telegraf');
const axios = require('axios');
const ipaInfo = require('ipa-extract-info');
const AdmZip = require('adm-zip'); // Thư viện giải nén mới
const http = require('http');

const bot = new Telegraf(process.env.BOT_TOKEN);

// Cấu hình GitHub
const GH_CONFIG = {
    owner: 'haduongyenn-ui',
    repo: 'haduongyenn-ui.github.io',
    token: process.env.GH_TOKEN
};

// Hàm tạo thanh loading
function makeProgressBar(percent) {
    const total = 10;
    const filled = Math.round((percent / 100) * total);
    return '■'.repeat(filled) + '□'.repeat(total - filled);
}

// Hàm trích xuất Team Name từ file mobileprovision
function getTeamNameFromZip(buffer) {
    try {
        const zip = new AdmZip(buffer);
        const zipEntries = zip.getEntries();
        
        // Tìm file embedded.mobileprovision trong file zip
        const provisionEntry = zipEntries.find(entry => entry.entryName.includes('embedded.mobileprovision'));
        
        if (provisionEntry) {
            // Đọc nội dung file dưới dạng text
            const content = zip.readAsText(provisionEntry);
            
            // Dùng Regex để tìm dòng TeamName
            // Cấu trúc thường là: <key>TeamName</key><string>Tên Team</string>
            const match = content.match(/<key>TeamName<\/key>\s*<string>([^<]+)<\/string>/);
            if (match && match[1]) {
                return match[1];
            }
        }
    } catch (e) {
        console.error("Lỗi đọc Team Name:", e.message);
    }
    return "Không xác định (App Store / TestFlight)";
}

// Hàm xử lý chính
async function processIpa(ctx, url, fileNameInput) {
    const initialMsg = await ctx.reply(`📥 **Bot đã nhận file!**\nĐang khởi tạo kết nối...`, { parse_mode: 'Markdown' });
    const msgId = initialMsg.message_id;
    const chatId = ctx.chat.id;

    let lastUpdate = 0;
    let lastPercent = 0;

    const updateProgress = async (text) => {
        const now = Date.now();
        if (now - lastUpdate > 1500 || text.includes('✅')) { 
            try {
                await ctx.telegram.editMessageText(chatId, msgId, undefined, text, { parse_mode: 'Markdown' });
                lastUpdate = now;
            } catch (e) {} 
        }
    };

    try {
        // --- TẢI FILE ---
        const res = await axios.get(url, { 
            responseType: 'arraybuffer',
            onDownloadProgress: (progressEvent) => {
                const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total) || 0;
                if (percent - lastPercent >= 10) { 
                    updateProgress(`⬇️ **Đang tải về server:** ${percent}%\n${makeProgressBar(percent)}`);
                    lastPercent = percent;
                }
            }
        });
        
        await updateProgress(`⚙️ **Đang phân tích chứng chỉ...**`);
        
        const buffer = Buffer.from(res.data);
        
        // 1. Lấy thông tin cơ bản (Tên, Bundle, Version)
        const info = await ipaInfo(buffer);
        const appName = info.content['CFBundleDisplayName'] || info.content['CFBundleName'] || 'Unknown';
        const bundleId = info.content['CFBundleIdentifier'];
        const version = info.content['CFBundleShortVersionString'];
        
        // 2. Lấy thông tin Team Cert (MỚI)
        const teamName = getTeamNameFromZip(buffer);

        const newFileName = `${Date.now()}.ipa`;

        // --- UPLOAD ---
        await updateProgress(`⬆️ **Đang đẩy lên GitHub...**\nCert: _${teamName}_`);

        // Upload IPA
        await axios.put(`https://api.github.com/repos/${GH_CONFIG.owner}/${GH_CONFIG.repo}/contents/IPA/${newFileName}`, 
            { 
                message: `Upload ${appName} [${teamName}]`, 
                content: buffer.toString('base64') 
            },
            { 
                headers: { Authorization: `Bearer ${GH_CONFIG.token}` },
                maxBodyLength: Infinity,
                maxContentLength: Infinity
            }
        );

        // Upload Plist
        const plistContent = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>items</key><array><dict><key>assets</key><array><dict><key>kind</key><string>software-package</string><key>url</key><string>https://${GH_CONFIG.owner}.github.io/IPA/${newFileName}</string></dict></array><key>metadata</key><dict><key>bundle-identifier</key><string>${bundleId}</string><key>bundle-version</key><string>${version}</string><key>kind</key><string>software</string><key>title</key><string>${appName}</string></dict></dict></array></dict></plist>`).toString('base64');

        await axios.put(`https://api.github.com/repos/${GH_CONFIG.owner}/${GH_CONFIG.repo}/contents/Plist/${newFileName.replace('.ipa', '.plist')}`, 
            { message: `Create Plist ${appName}`, content: plistContent },
            { headers: { Authorization: `Bearer ${GH_CONFIG.token}` } }
        );

        // --- KẾT QUẢ ---
        const finalMsg = `
✅ **Upload hoàn tất!**

📱 **App:** ${appName}
🆔 **Bundle:** ${bundleId}
🔢 **Ver:** ${version}
👥 **Team:** ${teamName}

📦 **Link tải:**
https://${GH_CONFIG.owner}.github.io/IPA/${newFileName}

📲 **Cài trực tiếp:**
\`itms-services://?action=download-manifest&url=https://${GH_CONFIG.owner}.github.io/Plist/${newFileName.replace('.ipa', '.plist')}\`
`;
        await ctx.telegram.editMessageText(chatId, msgId, undefined, finalMsg, { parse_mode: 'Markdown', disable_web_page_preview: true });

    } catch (e) {
        console.error(e);
        await updateProgress(`❌ **Lỗi:** ${e.message}`);
    }
}

// Các lệnh bot
bot.start((ctx) => {
    ctx.reply('👋 Xin chào! Gửi file IPA để mình check Team Cert và Upload nhé.');
});

bot.on('document', async (ctx) => {
    const doc = ctx.message.document;
    if (!doc.file_name.toLowerCase().endsWith('.ipa')) return ctx.reply('⚠️ Chỉ nhận file .ipa');
    if (doc.file_size > 20 * 1024 * 1024) return ctx.reply('❌ File > 20MB. Vui lòng gửi Link.');
    const link = await ctx.telegram.getFileLink(doc.file_id);
    await processIpa(ctx, link.href, doc.file_name);
});

bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith('http')) await processIpa(ctx, text, 'URL');
});

http.createServer((req, res) => res.end('Bot Alive')).listen(process.env.PORT || 8080);
bot.launch();
