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
const FOLDER_NAME = 'IPA';    
const PLIST_FOLDER = 'Plist'; 

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

// --- HÀM XỬ LÝ IPA ---
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

// --- HÀM ĐỔI PASS P12 (ĐÃ FIX LỖI THÔNG BÁO) ---
async function executeP12Change(ctx, fileId, fileName, oldPass, newPass) {
    const msg = await ctx.reply('⏳ Đang xử lý file P12...');
    try {
        const link = await ctx.telegram.getFileLink(fileId);
        const res = await axios.get(link.href, { responseType: 'arraybuffer' });
        const p12Buffer = Buffer.from(res.data);
        const p12Base64 = p12Buffer.toString('binary');
        const p12Asn1 = forge.asn1.fromDer(p12Base64);
        
        let p12;
        let cert = null;
        let key = null;

        // BƯỚC 1: GIẢI MÃ (CỐ GẮNG BẮT MỌI LỖI)
        try {
            // strict = false để cố gắng đọc dù file hơi lạ
            p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, oldPass);
            
            // Tìm Certificate
            const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
            if (certBags[forge.pki.oids.certBag] && certBags[forge.pki.oids.certBag].length > 0) {
                cert = certBags[forge.pki.oids.certBag][0].cert;
            }

            // Tìm Private Key
            const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
            if (keyBags[forge.pki.oids.pkcs8ShroudedKeyBag] && keyBags[forge.pki.oids.pkcs8ShroudedKeyBag].length > 0) {
                key = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag][0].key;
            } else {
                const simpleKeyBags = p12.getBags({ bagType: forge.pki.oids.keyBag });
                 if (simpleKeyBags[forge.pki.oids.keyBag] && simpleKeyBags[forge.pki.oids.keyBag].length > 0) {
                    key = simpleKeyBags[forge.pki.oids.keyBag][0].key;
                }
            }

            // Nếu không lấy được Key hoặc Cert -> Coi như lỗi
            if (!cert || !key) {
                throw new Error("EMPTY_BAGS"); 
            }

        } catch (err) {
            // Đây là nơi bắt cái lỗi "undefined (reading 'notBefore')"
            console.log("Lỗi giải mã:", err.message);
            return ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, 
                '❌ **Thất bại!**\n\n' +
                'Có thể do:\n' +
                '1. **Sai mật khẩu cũ** (Kiểm tra kỹ lại).\n' +
                '2. File P12 dùng mã hóa đời mới (AES) mà bot chưa hỗ trợ.\n\n' +
                '👉 Vui lòng thử lại với mật khẩu khác.'
            );
        }

        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, '⚙️ Mật khẩu đúng! Đang đóng gói lại...');

        // BƯỚC 2: TẠO FILE MỚI
        const newKeyBag = {
            type: forge.pki.oids.pkcs8ShroudedKeyBag,
            key: key
        };

        const newCertBag = {
            type: forge.pki.oids.certBag,
            cert: cert
        };

        const newP12Asn1 = forge.pkcs12.toPkcs12Asn1(
            [newKeyBag],   // Keys
            [newCertBag],  // Certs
            newPass,       // Pass mới
            { algorithm: '3des' } // Dùng chuẩn 3DES tương thích mọi thiết bị
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
        '2️⃣ **Đổi Pass P12:** Gửi file `.p12` để bắt đầu.\n\n' +
        '🚀 Start!',
        { parse_mode: 'Markdown' }
    );
});

bot.on('document', async (ctx) => {
    const doc = ctx.message.document;
    const fileName = doc.file_name.toLowerCase();
    
    if (fileName.endsWith('.ipa')) {
        const link = await ctx.telegram.getFileLink(doc.file_id);
        if (doc.file_size > 20 * 1024 * 1024) return ctx.reply('❌ File > 20MB. Vui lòng gửi Link.');
        return await processIpa(ctx, link.href, doc.file_name);
    }
    
    if (fileName.endsWith('.p12')) {
        userSessions[ctx.chat.id] = {
            step: 'WAITING_OLD_PASS',
            fileId: doc.file_id,
            fileName: doc.file_name
        };
        return ctx.reply('🔑 **Bước 1:** Nhập **Mật khẩu CŨ** của file này:', { parse_mode: 'Markdown' });
    }

    ctx.reply('⚠️ Chỉ hỗ trợ file `.ipa` và `.p12`');
});

bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    const chatId = ctx.chat.id;

    if (userSessions[chatId]) {
        const session = userSessions[chatId];

        if (session.step === 'WAITING_OLD_PASS') {
            session.oldPass = text;
            session.step = 'WAITING_NEW_PASS'; 
            return ctx.reply('🆕 **Bước 2:** Nhập **Mật khẩu MỚI** muốn đổi:', { parse_mode: 'Markdown' });
        }

        if (session.step === 'WAITING_NEW_PASS') {
            const newPass = text;
            const fileId = session.fileId;
            const fileName = session.fileName;
            const oldPass = session.oldPass;
            delete userSessions[chatId]; 

            return await executeP12Change(ctx, fileId, fileName, oldPass, newPass);
        }
    }

    if (text.startsWith('http')) {
        await processIpa(ctx, text, 'URL');
    }
});

http.createServer((req, res) => res.end('Bot Alive')).listen(process.env.PORT || 8080);
bot.launch();
