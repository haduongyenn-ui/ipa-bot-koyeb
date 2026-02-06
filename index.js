const { Telegraf } = require('telegraf');
const axios = require('axios');
const AdmZip = require('adm-zip'); 
const forge = require('node-forge'); 
const http = require('http');

const bot = new Telegraf(process.env.BOT_TOKEN);

const GH_CONFIG = {
    owner: 'haduongyenn-ui',
    repo: 'haduongyenn-ui.github.io',
    token: process.env.GH_TOKEN
};

// 👇 CẤU HÌNH 👇
const CUSTOM_DOMAIN = 'https://download.khoindvn.io.vn'; 
const FOLDER_NAME = 'iPA';    
const PLIST_FOLDER = 'Plist'; 

// 💾 BỘ NHỚ TẠM ĐỂ LƯU TRẠNG THÁI NGƯỜI DÙNG
// Cấu trúc: { chatId: { step: 1, fileId: '...', fileName: '...', oldPass: '...' } }
const userSessions = {};

// --- HÀM TIỆN ÍCH ---
function makeProgressBar(percent) {
    const total = 10;
    const filled = Math.round((percent / 100) * total);
    return '■'.repeat(filled) + '□'.repeat(total - filled);
}

function makeRandomString(length) {
    let result = '';
    const characters = 'abcdefghijklmnopqrstuvwxyz';
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
}

// --- HÀM XỬ LÝ IPA (GIỮ NGUYÊN) ---
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
    const initialMsg = await ctx.reply(`📥 **Bot đã nhận file IPA!**\nĐang tải về...`, { parse_mode: 'Markdown' });
    const msgId = initialMsg.message_id;
    const chatId = ctx.chat.id;
    let lastUpdate = 0;

    const updateProgress = async (text) => {
        const now = Date.now();
        if (now - lastUpdate > 1500 || text.includes('✅')) { 
            try { await ctx.telegram.editMessageText(chatId, msgId, undefined, text, { parse_mode: 'Markdown' }); lastUpdate = now; } catch (e) {} 
        }
    };

    try {
        const res = await axios.get(url, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(res.data);
        
        await updateProgress(`⚙️ **Đang phân tích file...**`);
        const info = parseIpa(buffer);
        
        const randomName = makeRandomString(5); 
        const newFileName = `${randomName}.ipa`;
        const ipaPath = `${FOLDER_NAME}/${newFileName}`;
        const plistPath = `${PLIST_FOLDER}/${newFileName.replace('.ipa', '.plist')}`;
        const ipaDirectLink = `${CUSTOM_DOMAIN}/${ipaPath}`;
        const plistDirectLink = `${CUSTOM_DOMAIN}/${plistPath}`;

        await updateProgress(`⬆️ **Đang upload: ${newFileName}...**`);

        await axios.put(`https://api.github.com/repos/${GH_CONFIG.owner}/${GH_CONFIG.repo}/contents/${ipaPath}`, 
            { message: `Upload ${info.name}`, content: buffer.toString('base64') },
            { headers: { Authorization: `Bearer ${GH_CONFIG.token}` }, maxBodyLength: Infinity, maxContentLength: Infinity }
        );

        const plistContent = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>items</key><array><dict><key>assets</key><array><dict><key>kind</key><string>software-package</string><key>url</key><string>${ipaDirectLink}</string></dict></array><key>metadata</key><dict><key>bundle-identifier</key><string>${info.bundle}</string><key>bundle-version</key><string>${info.version}</string><key>kind</key><string>software</string><key>title</key><string>${info.name}</string></dict></dict></array></dict></plist>`).toString('base64');

        await axios.put(`https://api.github.com/repos/${GH_CONFIG.owner}/${GH_CONFIG.repo}/contents/${plistPath}`, 
            { message: `Create Plist ${info.name}`, content: plistContent },
            { headers: { Authorization: `Bearer ${GH_CONFIG.token}` } }
        );

        const finalMsg = `✅ **Upload hoàn tất!**\n\n📁 **File:** \`${ipaPath}\`\n📱 **App:** ${info.name}\n🆔 **Bundle:** ${info.bundle}\n🔢 **Ver:** ${info.version}\n👥 **Team:** ${info.team}\n\n📦 **Link tải:**\n${ipaDirectLink}\n\n📲 **Cài trực tiếp:**\n\`itms-services://?action=download-manifest&url=${plistDirectLink}\``;
        await ctx.telegram.editMessageText(chatId, msgId, undefined, finalMsg, { parse_mode: 'Markdown', disable_web_page_preview: true });

    } catch (e) {
        await updateProgress(`❌ **Lỗi:** ${e.message}`);
    }
}

// --- HÀM THỰC HIỆN ĐỔI PASS P12 (KHI ĐÃ ĐỦ THÔNG TIN) ---
async function executeP12Change(ctx, fileId, fileName, oldPass, newPass) {
    const msg = await ctx.reply('⏳ Đang tải file và xử lý...');
    try {
        // Lấy link tải từ Telegram
        const link = await ctx.telegram.getFileLink(fileId);
        
        // Tải file về
        const res = await axios.get(link.href, { responseType: 'arraybuffer' });
        const p12Buffer = Buffer.from(res.data);
        const p12Base64 = p12Buffer.toString('binary');

        // Giải mã P12 cũ
        const p12Asn1 = forge.asn1.fromDer(p12Base64);
        let p12;
        try {
            p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, oldPass);
        } catch (err) {
            return ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, '❌ **Sai mật khẩu cũ!** Vui lòng gửi lại file để thử lại.');
        }

        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, '⚙️ Mật khẩu cũ đúng! Đang mã hóa sang mật khẩu mới...');

        // Đóng gói lại với pass mới
        const newP12Asn1 = forge.pkcs12.toPkcs12Asn1(
            p12.safeContents, 
            p12.safeContents, 
            newPass,
            { algorithm: '3des' }
        );

        const newP12Der = forge.asn1.toDer(newP12Asn1).getBytes();
        const newP12Buffer = Buffer.from(newP12Der, 'binary');

        // Gửi file
        await ctx.replyWithDocument({
            source: newP12Buffer,
            filename: `NewPass_${fileName}`
        }, {
            caption: `✅ **Thành công!**\n\n🔑 Mật khẩu mới: \`${newPass}\``,
            parse_mode: 'Markdown'
        });

        await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id);

    } catch (e) {
        console.error(e);
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `❌ Lỗi hệ thống: ${e.message}`);
    }
}

// --- XỬ LÝ SỰ KIỆN ---

bot.start((ctx) => {
    ctx.reply(
        '👋 **Xin chào!**\n\n' +
        '1️⃣ **Upload IPA:** Gửi file `.ipa` hoặc Link.\n' +
        '2️⃣ **Đổi Pass P12:** Cứ gửi file `.p12` vào đây, mình sẽ hỏi mật khẩu sau.\n\n' +
        '🚀 Bắt đầu thôi!',
        { parse_mode: 'Markdown' }
    );
});

// Xử lý khi nhận FILE
bot.on('document', async (ctx) => {
    const doc = ctx.message.document;
    const fileName = doc.file_name.toLowerCase();
    
    // 1. XỬ LÝ IPA (Chạy luôn như cũ)
    if (fileName.endsWith('.ipa')) {
        const link = await ctx.telegram.getFileLink(doc.file_id);
        if (doc.file_size > 20 * 1024 * 1024) return ctx.reply('❌ File > 20MB. Vui lòng gửi Link.');
        return await processIpa(ctx, link.href, doc.file_name);
    }
    
    // 2. XỬ LÝ P12 (Bắt đầu hội thoại)
    if (fileName.endsWith('.p12')) {
        // Lưu trạng thái người dùng
        userSessions[ctx.chat.id] = {
            step: 'WAITING_OLD_PASS',
            fileId: doc.file_id,
            fileName: doc.file_name
        };
        return ctx.reply('🔑 **Bước 1:** Vui lòng nhập **Mật khẩu CŨ** của file này:', { parse_mode: 'Markdown' });
    }

    ctx.reply('⚠️ Chỉ hỗ trợ file `.ipa` và `.p12`');
});

// Xử lý khi nhận TIN NHẮN VĂN BẢN
bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    const chatId = ctx.chat.id;

    // Kiểm tra xem người dùng có đang trong quá trình đổi pass không
    if (userSessions[chatId]) {
        const session = userSessions[chatId];

        // BƯỚC 2: Nhận mật khẩu cũ -> Hỏi mật khẩu mới
        if (session.step === 'WAITING_OLD_PASS') {
            session.oldPass = text;
            session.step = 'WAITING_NEW_PASS'; // Chuyển sang bước tiếp theo
            return ctx.reply('🆕 **Bước 2:** Nhập **Mật khẩu MỚI** bạn muốn đổi:', { parse_mode: 'Markdown' });
        }

        // BƯỚC 3: Nhận mật khẩu mới -> Thực hiện đổi
        if (session.step === 'WAITING_NEW_PASS') {
            const newPass = text;
            
            // Xóa phiên làm việc để tránh lỗi lần sau
            const fileId = session.fileId;
            const fileName = session.fileName;
            const oldPass = session.oldPass;
            delete userSessions[chatId]; // Dọn dẹp bộ nhớ

            // Gọi hàm xử lý
            return await executeP12Change(ctx, fileId, fileName, oldPass, newPass);
        }
    }

    // Nếu không phải đang chat đổi pass thì kiểm tra xem có phải link IPA không
    if (text.startsWith('http')) {
        await processIpa(ctx, text, 'URL');
    }
});

http.createServer((req, res) => res.end('Bot Alive')).listen(process.env.PORT || 8080);
bot.launch();
