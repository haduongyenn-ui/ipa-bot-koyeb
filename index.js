const { Telegraf } = require('telegraf');
const axios = require('axios');
const AdmZip = require('adm-zip'); 
const http = require('http');
const fs = require('fs');
const { exec } = require('child_process'); 
const path = require('path');

// --- 1. CẤU HÌNH BIẾN MÔI TRƯỜNG ---
const bot = new Telegraf(process.env.BOT_TOKEN);

const GH_CONFIG = {
    owner: 'haduongyenn-ui',
    repo: 'haduongyenn-ui.github.io',
    token: process.env.GH_TOKEN
};

const CUSTOM_DOMAIN = 'https://download.khoindvn.io.vn'; 
const PLIST_API_DOMAIN = 'https://muacert.com'; 
const FOLDER_NAME = 'ipa';    
const PLIST_FOLDER = 'plist'; 
const userSessions = {};

// --- 2. CÁC HÀM XỬ LÝ ---

function encodePlistPayload(appName, iconURL, bundleID, ipaURL) {
    const payload = `${appName},${iconURL},${bundleID},${ipaURL}`;
    let base64 = Buffer.from(payload).toString('base64');
    return base64.replace(/\+/g, 'waiwai').replace(/\//g, 'qq1545172453').replace(/=/g, 'ysign');
}

function decodePlistPayload(encoded) {
    try {
        const base64 = encoded.replace(/waiwai/g, '+').replace(/qq1545172453/g, '/').replace(/ysign/g, '=');
        const decoded = Buffer.from(base64, 'base64').toString('utf-8');
        const parts = decoded.split(',');
        return parts.length === 4 ? { appName: parts[0], iconURL: parts[1], bundleID: parts[2], ipaURL: parts[3] } : null;
    } catch (e) { return null; }
}

function generatePlistXml(data) {
    const esc = (s) => s.replace(/[<>&"']/g, (m) => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":"&apos;"}[m]));
    return `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>items</key><array><dict><key>assets</key><array><dict><key>kind</key><string>software-package</string><key>url</key><string>${esc(data.ipaURL)}</string></dict></array><key>metadata</key><dict><key>bundle-identifier</key><string>${esc(data.bundleID)}</string><key>bundle-version</key><string>1.0</string><key>kind</key><string>software</string><key>title</key><string>${esc(data.appName)}</string></dict></dict></array></dict></plist>`;
}

function makeRandomString(length) {
    let result = '';
    const char = 'abcdefghijklmnopqrstuvwxyz';
    for (let i = 0; i < length; i++) result += char.charAt(Math.floor(Math.random() * char.length));
    return result;
}

function parseIpa(buffer) {
    try {
        const zip = new AdmZip(buffer);
        const zipEntries = zip.getEntries();
        let appInfo = { name: 'Unknown', bundle: 'Unknown', version: '1.0', team: 'Unknown' };
        const entry = zipEntries.find(e => e.entryName.match(/^Payload\/[^/]+\.app\/Info\.plist$/));
        if (entry) {
            const content = zip.readAsText(entry);
            const getV = (k) => (content.match(new RegExp(`<key>${k}<\\/key>\\s*<string>([^<]+)<\\/string>`)) || [])[1];
            appInfo.name = getV('CFBundleDisplayName') || getV('CFBundleName') || 'App';
            appInfo.bundle = getV('CFBundleIdentifier') || 'com.unknown';
            appInfo.version = getV('CFBundleShortVersionString') || '1.0';
        }
        const provisionEntry = zipEntries.find(entry => entry.entryName.includes('embedded.mobileprovision'));
        if (provisionEntry) {
            const content = zip.readAsText(provisionEntry);
            const teamMatch = content.match(/<key>TeamName<\/key>\s*<string>([^<]+)<\/string>/);
            if (teamMatch) appInfo.team = teamMatch[1];
        }
        return appInfo;
    } catch (e) { return { name: 'Error', bundle: 'Error', version: '0.0', team: 'Unknown' }; }
}

async function processIpa(ctx, url) {
    const initialMsg = await ctx.reply(`📥 **Đang tải IPA...**`, { parse_mode: 'Markdown' });
    try {
        const res_ipa = await axios.get(url, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(res_ipa.data);
        const info = parseIpa(buffer);
        const randomName = makeRandomString(5); 
        const newFileName = `${randomName}.ipa`;
        const ipaPath = `${FOLDER_NAME}/${newFileName}`;
        const plistPath = `${PLIST_FOLDER}/${newFileName.replace('.ipa', '.plist')}`;

        await axios.put(`https://api.github.com/repos/${GH_CONFIG.owner}/${GH_CONFIG.repo}/contents/${ipaPath}`, 
            { message: `Upload ${info.name}`, content: buffer.toString('base64') },
            { headers: { Authorization: `Bearer ${GH_CONFIG.token}` }, maxBodyLength: Infinity }
        );

        const ipaDirectUrl = `${CUSTOM_DOMAIN}/${ipaPath}`;
        const plistStatic = Buffer.from(generatePlistXml({ appName: info.name, iconURL: '', bundleID: info.bundle, ipaURL: ipaDirectUrl })).toString('base64');
        await axios.put(`https://api.github.com/repos/${GH_CONFIG.owner}/${GH_CONFIG.repo}/contents/${plistPath}`, 
            { message: `Create Plist ${info.name}`, content: plistStatic },
            { headers: { Authorization: `Bearer ${GH_CONFIG.token}` } }
        );

        // Tin nhắn mẫu y hệt cũ, loại bỏ link API mới khỏi hiển thị
        const finalMsg = `✅ **Upload hoàn tất!**

📱 App: \`${info.name}\`
🆔 Bundle: \`${info.bundle}\`
🔢 Ver: \`${info.version}\`
👥 Team: \`${info.team}\`

📦 **Link tải:**
${ipaDirectUrl}

📲 **Cài trực tiếp:**
\`itms-services://?action=download-manifest&url=${CUSTOM_DOMAIN}/${plistPath}\``;

        await ctx.telegram.editMessageText(ctx.chat.id, initialMsg.message_id, undefined, finalMsg, { parse_mode: 'Markdown', disable_web_page_preview: true });
    } catch (e) { await ctx.reply(`❌ Lỗi: ${e.message}`); }
}

async function executeP12Change(ctx, fileId, fileName, oldPass, newPass) {
    const msg = await ctx.reply('⏳ Đang xử lý P12...');
    const tempId = Date.now();
    const inputPath = path.resolve(__dirname, `input_${tempId}.p12`);
    const pemPath = path.resolve(__dirname, `temp_${tempId}.pem`);
    const outputPath = path.resolve(__dirname, `output_${tempId}.p12`);
    try {
        const link = await ctx.telegram.getFileLink(fileId);
        const res_p12 = await axios.get(link.href, { responseType: 'arraybuffer' });
        fs.writeFileSync(inputPath, Buffer.from(res_p12.data));
        exec(`openssl pkcs12 -in "${inputPath}" -out "${pemPath}" -nodes -passin pass:"${oldPass}" -legacy`, (error) => {
            if (error) return ctx.reply('❌ Mật khẩu CŨ không đúng!');
            exec(`openssl x509 -in "${pemPath}" -noout -subject -enddate`, (errInfo, stdoutInfo) => {
                let teamName = (stdoutInfo.match(/CN\s*=\s*([^/\n,]+)/) || [])[1] || "Unknown";
                let expDate = (stdoutInfo.match(/notAfter=(.*)/) || [])[1] || "Unknown";
                exec(`openssl pkcs12 -export -in "${pemPath}" -out "${outputPath}" -passout pass:"${newPass}" -legacy`, async () => {
                    await ctx.replyWithDocument({ source: fs.createReadStream(outputPath), filename: `NewPass_${fileName}` }, {
                        caption: `✅ **Thành công!**\n👥 Team: \`${teamName}\`\n📅 Hết hạn: \`${expDate}\`\n🔑 Pass: \`${newPass}\``,
                        parse_mode: 'Markdown'
                    });
                    [inputPath, pemPath, outputPath].forEach(p => { if(fs.existsSync(p)) fs.unlinkSync(p); });
                });
            });
        });
    } catch (e) { ctx.reply(`❌ Lỗi: ${e.message}`); }
}

bot.start((ctx) => ctx.reply('👋 Gửi IPA hoặc P12!'));
bot.on('document', async (ctx) => {
    const doc = ctx.message.document;
    const name = doc.file_name.toLowerCase();
    if (name.endsWith('.ipa')) {
        const link = await ctx.telegram.getFileLink(doc.file_id);
        await processIpa(ctx, link.href);
    } else if (name.endsWith('.p12')) {
        userSessions[ctx.chat.id] = { step: 'OLD', fileId: doc.file_id, fileName: doc.file_name };
        ctx.reply('🔑 Mật khẩu CŨ:');
    }
});
bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    const session = userSessions[ctx.chat.id];
    if (session) {
        if (session.step === 'OLD') { session.oldPass = text; session.step = 'NEW'; ctx.reply('🆕 Mật khẩu MỚI:'); }
        else if (session.step === 'NEW') { 
            const { fileId, fileName, oldPass } = session; delete userSessions[ctx.chat.id];
            await executeP12Change(ctx, fileId, fileName, oldPass, text); 
        }
    } else if (text.startsWith('http')) await processIpa(ctx, text);
});
bot.launch();

http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === '/api/plist') {
        const data = decodePlistPayload(url.search.substring(1));
        if (!data) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ code: 400, message: "invalid encoded payload" }));
        }
        res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
        return res.end(generatePlistXml(data));
    }

    if (req.method === 'POST' && url.pathname === '/api/bypass') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const { targetUrl } = JSON.parse(body);
                const apiRes = await axios.get(`https://api.izen.lol/v1/bypass?url=${encodeURIComponent(targetUrl)}`);
                res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify(apiRes.data));
            } catch (e) { res.writeHead(500); res.end(JSON.stringify({ message: "Lỗi API" })); }
        });
        return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Khơindvn BYPASS</title><script src="https://cdn.tailwindcss.com"></script></head><body class="py-10 px-4 flex flex-col items-center"><div class="w-full max-w-md space-y-8 text-center"><h1 class="text-3xl font-black text-sky-400">KHƠINDVN BYPASS</h1><input type="text" id="targetUrl" placeholder="Dán link tại đây..." class="w-full p-4 rounded-2xl bg-black text-sky-400 mb-6 text-center outline-none"><button onclick="doBypass()" id="btn" class="w-full bg-sky-500 text-white font-black py-4 rounded-2xl">BYPASS NGAY</button><div id="result" class="hidden mt-8"><div id="copyText" class="text-sky-300 break-all mb-4"></div><button onclick="copyToClipboard()" class="w-full bg-slate-800 text-sky-400 py-3 rounded-xl">📋 SAO CHÉP</button></div></div><script>async function doBypass(){const btn=document.getElementById('btn');const resDiv=document.getElementById('result');const val=document.getElementById('targetUrl').value;if(!val)return;btn.innerText='ĐANG XỬ LÝ...';try{const r=await fetch('/api/bypass',{method:'POST',body:JSON.stringify({targetUrl:val})});const d=await r.json();if(d.result){resDiv.classList.remove('hidden');document.getElementById('copyText').innerText=d.result;}else{alert('Lỗi API');}}catch(e){alert('Lỗi kết nối!');}btn.innerText='BYPASS NGAY';}function copyToClipboard(){const t=document.getElementById('copyText').innerText;navigator.clipboard.writeText(t).then(()=>alert('Đã sao chép!'));}</script></body></html>`);
}).listen(process.env.PORT || 8080);
