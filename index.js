const { Telegraf } = require('telegraf');
const axios = require('axios');
const AdmZip = require('adm-zip'); 
const http = require('http');
const fs = require('fs');
const { exec } = require('child_process'); // Gọi lệnh hệ thống
const path = require('path');

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

// --- HÀM ĐỔI PASS P12 (DÙNG OPENSSL - CÂN MỌI LOẠI FILE) ---
async function executeP12Change(ctx, fileId, fileName, oldPass, newPass) {
    const msg = await ctx.reply('⏳ Đang xử lý bằng OpenSSL...');
    
    // Tạo tên file tạm
    const tempId = Date.now();
    const inputPath = path.resolve(__dirname, `input_${tempId}.p12`);
    const pemPath = path.resolve(__dirname, `temp_${tempId}.pem`);
    const outputPath = path.resolve(__dirname, `output_${tempId}.p12`);

    try {
        // 1. Tải file về và lưu vào ổ cứng
        const link = await ctx.telegram.getFileLink(fileId);
        const res = await axios.get(link.href, { responseType: 'arraybuffer' });
        fs.writeFileSync(inputPath, Buffer.from(res.data));

        // 2. Chạy lệnh OpenSSL: Giải nén P12 cũ ra file PEM (Chứa Key + Cert)
        // -nodes: Không mã hóa file PEM tạm
        // -legacy: Hỗ trợ cả chuẩn cũ (RC2/3DES) nếu server dùng OpenSSL 3
        const cmdExport = `openssl pkcs12 -in "${inputPath}" -out "${pemPath}" -nodes -passin pass:"${oldPass}" -legacy`;

        exec(cmdExport, (error, stdout, stderr) => {
            if (error) {
                console.error("Lỗi Export:", stderr);
                // Dọn dẹp
                try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); } catch(e){}
                
                return ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, 
                    '❌ **Mật khẩu CŨ không đúng!**\n(Hoặc file bị lỗi). Vui lòng thử lại.'
                );
            }

            // 3. Chạy lệnh OpenSSL: Đóng gói PEM thành P12 mới với mật khẩu mới
            const cmdImport = `openssl pkcs12 -export -in "${pemPath}" -out "${outputPath}" -passout pass:"${newPass}" -legacy`;

            exec(cmdImport, async (err2, out2, stderr2) => {
                // Dọn file tạm PEM ngay lập tức
                try { if (fs.existsSync(pemPath)) fs.unlinkSync(pemPath); } catch(e){}
                try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); } catch(e){}

                if (err2) {
                    return ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `❌ Lỗi đóng gói: ${stderr2}`);
                }

                // 4. Gửi file kết quả
                if (fs.existsSync(outputPath)) {
                    await ctx.replyWithDocument({
                        source: fs.createReadStream(outputPath),
                        filename: `NewPass_${fileName}`
                    }, {
                        caption: `✅ **Đổi mật khẩu thành công!**\n\n🔑 Mật khẩu mới: \`${newPass}\``,
                        parse_mode: 'Markdown'
                    });
                    
                    // Xóa file kết quả
                    fs.unlinkSync(outputPath);
                    await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id);
                } else {
                    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, '❌ Lỗi: Không tạo được file đầu ra.');
                }
            });
        });

    } catch (e) {
        console.error(e);
        // Dọn dẹp nếu lỗi
        try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); } catch(e){}
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `❌ Lỗi hệ thống: ${e.message}`);
    }
}

// --- XỬ LÝ SỰ KIỆN ---

bot.start((ctx) => {
    ctx.reply(
        '👋 **Xin chào!**\n\n' +
        '1️⃣ **Upload IPA:** Gửi file `.ipa` hoặc Link.\n' +
        '2️⃣ **Đổi Pass P12:** Gửi file `.p12` (Hỗ trợ mọi loại mã hóa).\n\n' +
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
