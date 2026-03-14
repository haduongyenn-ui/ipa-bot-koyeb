const { Telegraf } = require('telegraf');
const axios = require('axios');
const AdmZip = require('adm-zip'); 
const http = require('http');
const fs = require('fs');
const { exec } = require('child_process'); 
const path = require('path');

// --- CẤU HÌNH BIẾN MÔI TRƯỜNG ---
const bot = new Telegraf(process.env.BOT_TOKEN);
const IZEN_API_KEY = process.env.IZEN_API_KEY;

const GH_CONFIG = {
    owner: 'haduongyenn-ui',
    repo: 'haduongyenn-ui.github.io',
    token: process.env.GH_TOKEN
};

const CUSTOM_DOMAIN = 'https://download.khoindvn.io.vn'; 
const FOLDER_NAME = 'iPA';    
const PLIST_FOLDER = 'Plist'; 
const userSessions = {};

// --- HÀM TIỆN ÍCH ---
function makeRandomString(length) {
    let result = '';
    const characters = 'abcdefghijklmnopqrstuvwxyz';
    for (let i = 0; i < length; i++) result += characters.charAt(Math.floor(Math.random() * characters.length));
    return result;
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

async function processIpa(ctx, url) {
    const initialMsg = await ctx.reply(`📥 **Bot đã nhận file IPA!**\nĐang tải về...`, { parse_mode: 'Markdown' });
    try {
        const res = await axios.get(url, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(res.data);
        const info = parseIpa(buffer);
        
        const randomName = makeRandomString(5); 
        const newFileName = `${randomName}.ipa`;
        const ipaPath = `${FOLDER_NAME}/${newFileName}`;
        const plistPath = `${PLIST_FOLDER}/${newFileName.replace('.ipa', '.plist')}`;

        // Upload iPA to GitHub
        await axios.put(`https://api.github.com/repos/${GH_CONFIG.owner}/${GH_CONFIG.repo}/contents/${ipaPath}`, 
            { message: `Upload ${info.name}`, content: buffer.toString('base64') },
            { headers: { Authorization: `Bearer ${GH_CONFIG.token}` }, maxBodyLength: Infinity }
        );

        // Create Plist
        const plistContent = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>items</key><array><dict><key>assets</key><array><dict><key>kind</key><string>software-package</string><key>url</key><string>${CUSTOM_DOMAIN}/${ipaPath}</string></dict></array><key>metadata</key><dict><key>bundle-identifier</key><string>${info.bundle}</string><key>bundle-version</key><string>${info.version}</string><key>kind</key><string>software</string><key>title</key><string>${info.name}</string></dict></dict></array></dict></plist>`).toString('base64');

        await axios.put(`https://api.github.com/repos/${GH_CONFIG.owner}/${GH_CONFIG.repo}/contents/${plistPath}`, 
            { message: `Create Plist ${info.name}`, content: plistContent },
            { headers: { Authorization: `Bearer ${GH_CONFIG.token}` } }
        );

        const finalMsg = `✅ **Upload hoàn tất!**\n\n📱 App: \`${info.name}\`\n🆔 Bundle: \`${info.bundle}\`\n🔢 Ver: \`${info.version}\`\n👥 Team: \`${info.team}\`\n\n📦 **Link tải:**\n${CUSTOM_DOMAIN}/${ipaPath}\n\n📲 **Cài trực tiếp:**\n\`itms-services://?action=download-manifest&url=${CUSTOM_DOMAIN}/${plistPath}\``;
        
        await ctx.telegram.editMessageText(ctx.chat.id, initialMsg.message_id, undefined, finalMsg, { parse_mode: 'Markdown', disable_web_page_preview: true });
    } catch (e) {
        await ctx.reply(`❌ Lỗi: ${e.message}`);
    }
}

async function executeP12Change(ctx, fileId, fileName, oldPass, newPass) {
    const msg = await ctx.reply('⏳ Đang xử lý bằng OpenSSL...');
    const tempId = Date.now();
    const inputPath = path.resolve(__dirname, `input_${tempId}.p12`);
    const pemPath = path.resolve(__dirname, `temp_${tempId}.pem`);
    const outputPath = path.resolve(__dirname, `output_${tempId}.p12`);

    try {
        const link = await ctx.telegram.getFileLink(fileId);
        const res = await axios.get(link.href, { responseType: 'arraybuffer' });
        fs.writeFileSync(inputPath, Buffer.from(res.data));

        const cmdExport = `openssl pkcs12 -in "${inputPath}" -out "${pemPath}" -nodes -passin pass:"${oldPass}" -legacy`;
        exec(cmdExport, (error) => {
            if (error) return ctx.reply('❌ Mật khẩu CŨ không đúng!');

            const cmdInfo = `openssl x509 -in "${pemPath}" -noout -subject -enddate`;
            exec(cmdInfo, (errInfo, stdoutInfo) => {
                let teamName = (stdoutInfo.match(/CN\s*=\s*([^/\n,]+)/) || [])[1] || "Unknown";
                let expDate = (stdoutInfo.match(/notAfter=(.*)/) || [])[1] || "Unknown";

                const cmdImport = `openssl pkcs12 -export -in "${pemPath}" -out "${outputPath}" -passout pass:"${newPass}" -legacy`;
                exec(cmdImport, async () => {
                    await ctx.replyWithDocument({ source: fs.createReadStream(outputPath), filename: `NewPass_${fileName}` }, {
                        caption: `✅ **Đổi mật khẩu thành công!**\n\n👥 Team: \`${teamName}\`\n📅 Exp: \`${expDate}\`\n🔑 Pass: \`${newPass}\`\n\n_Ấn vào chữ để sao chép_`,
                        parse_mode: 'Markdown'
                    });
                    [inputPath, pemPath, outputPath].forEach(p => { if(fs.existsSync(p)) fs.unlinkSync(p); });
                    ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id);
                });
            });
        });
    } catch (e) { ctx.reply(`❌ Lỗi hệ thống: ${e.message}`); }
}

// --- BOT EVENTS ---
bot.start((ctx) => ctx.reply('👋 Chào mừng! Gửi IPA để upload hoặc P12 để đổi pass.'));
bot.on('document', async (ctx) => {
    const doc = ctx.message.document;
    const name = doc.file_name.toLowerCase();
    if (name.endsWith('.ipa')) {
        const link = await ctx.telegram.getFileLink(doc.file_id);
        await processIpa(ctx, link.href);
    } else if (name.endsWith('.p12')) {
        userSessions[ctx.chat.id] = { step: 'OLD', fileId: doc.file_id, fileName: doc.file_name };
        ctx.reply('🔑 Nhập **Mật khẩu CŨ**:');
    }
});
bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    const session = userSessions[ctx.chat.id];
    if (session) {
        if (session.step === 'OLD') {
            session.oldPass = text; session.step = 'NEW';
            ctx.reply('🆕 Nhập **Mật khẩu MỚI**:');
        } else if (session.step === 'NEW') {
            const { fileId, fileName, oldPass } = session;
            delete userSessions[ctx.chat.id];
            await executeP12Change(ctx, fileId, fileName, oldPass, text);
        }
    } else if (text.startsWith('http')) {
        await processIpa(ctx, text);
    }
});
bot.launch();

// --- SERVER HTTP ---
http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
        res.end(); return;
    }

    if (req.method === 'POST' && url.pathname === '/api/bypass') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const { targetUrl } = JSON.parse(body);
                const apiRes = await axios.get(`https://api.izen.lol/v1/bypass?url=${encodeURIComponent(targetUrl)}`, { headers: { 'x-api-key': IZEN_API_KEY } });
                res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify(apiRes.data));
            } catch (e) { res.writeHead(500, { 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify({ message: "Lỗi API" })); }
        });
        return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
    <!DOCTYPE html>
    <html lang="vi">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>iZen Hub - Bypass & IPA</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <script src='https://hairsromance.com/g_q7aDmbA6aQh_XP/NVmh3f9uxKIU/zfv1OaVj8ATdn9EoEUL/Sghia89fFxp9UPfhw/EFtHxA8b4FCkRQEKW/olNVY/jXefY8K8Jq3EcEhNQn/tgHzaiCkWC49/dyzeXgu5z'></script>
        <script src="https://offeringchewjean.com/47/a9/13/47a913b960040fe7926ec0833cfc6151.js"></script>
        <style>body{background:#0f172a;color:white;font-family:sans-serif;}.glass{background:rgba(30,41,59,0.7);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,0.1);}</style>
    </head>
    <body class="py-10 px-4 flex flex-col items-center">
        <div class="w-full max-w-md space-y-6 text-center">
            <div class="flex justify-center mb-4">
                <script type="text/javascript">atOptions = {'key' : '3434ba1486d99ce41866b861388f09c5','format' : 'iframe','height' : 50,'width' : 320,'params' : {}};</script>
                <script type="text/javascript" src="https://hairsromance.com/3434ba1486d99ce41866b861388f09c5/invoke.js"></script>
            </div>
            <div class="glass p-6 rounded-3xl shadow-xl">
                <h1 class="text-2xl font-bold text-sky-400 mb-4 uppercase">Link Bypass</h1>
                <input type="text" id="targetUrl" placeholder="Dán link cần bypass..." class="w-full p-4 rounded-2xl bg-slate-900 border border-slate-700 mb-4 outline-none focus:border-sky-500">
                <button onclick="doBypass()" id="btn" class="w-full bg-sky-500 text-slate-900 font-bold py-4 rounded-2xl active:scale-95 transition-all">BYPASS NGAY</button>
                <div id="result" class="hidden mt-6 p-4 rounded-2xl bg-black border border-slate-800 text-left">
                    <div class="text-emerald-400 text-[10px] font-bold mb-2 uppercase">✨ Bypass Thành Công!</div>
                    <div id="copyText" class="text-sky-300 font-mono text-sm break-all mb-4"></div>
                    <button onclick="copyToClipboard()" class="w-full bg-slate-800 py-3 rounded-xl text-xs font-bold border border-slate-700">📋 SAO CHÉP KẾT QUẢ</button>
                </div>
            </div>
            <div class="glass p-6 rounded-3xl shadow-xl">
                <h2 class="text-xl font-bold text-emerald-400 mb-4 uppercase">Kho iPA Roblox</h2>
                <div class="space-y-3">
                    <a href="itms-services://?action=download-manifest&url=https://download.khoindvn.io.vn/Plist/sample.plist" class="block p-4 bg-slate-800 rounded-2xl hover:bg-slate-700 transition-all">Delta Executor (iPA)</a>
                </div>
            </div>
        </div>
        <script>
            async function doBypass(){
                const btn=document.getElementById('btn');const resDiv=document.getElementById('result');const val=document.getElementById('targetUrl').value;
                if(!val)return alert('Dán link đã!');btn.innerText='ĐANG XỬ LÝ...';btn.disabled=true;
                try{
                    const r=await fetch('/api/bypass',{method:'POST',body:JSON.stringify({targetUrl:val})});
                    const d=await r.json();
                    if(d.result){resDiv.classList.remove('hidden');document.getElementById('copyText').innerText=d.result;}
                    else{alert('Lỗi API');}
                }catch(e){alert('Lỗi kết nối!');}
                btn.innerText='BYPASS NGAY';btn.disabled=false;
            }
            function copyToClipboard(){navigator.clipboard.writeText(document.getElementById('copyText').innerText);alert('Đã sao chép!');}
        </script>
    </body>
    </html>
    `);
}).listen(process.env.PORT || 8080);
