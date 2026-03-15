const { Telegraf } = require('telegraf');
const axios = require('axios');
const AdmZip = require('adm-zip'); 
const http = require('http');
const fs = require('fs');
const { exec } = require('child_process'); 
const path = require('path');

// --- 1. CẤU HÌNH BIẾN MÔI TRƯỜNG ---
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

// --- 2. CÁC HÀM XỬ LÝ (IPA, P12...) ---
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

        const plistContent = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>items</key><array><dict><key>assets</key><array><dict><key>kind</key><string>software-package</string><key>url</key><string>${CUSTOM_DOMAIN}/${ipaPath}</string></dict></array><key>metadata</key><dict><key>bundle-identifier</key><string>${info.bundle}</string><key>bundle-version</key><string>${info.version}</string><key>kind</key><string>software</string><key>title</key><string>${info.name}</string></dict></dict></array></dict></plist>`).toString('base64');

        await axios.put(`https://api.github.com/repos/${GH_CONFIG.owner}/${GH_CONFIG.repo}/contents/${plistPath}`, 
            { message: `Create Plist ${info.name}`, content: plistContent },
            { headers: { Authorization: `Bearer ${GH_CONFIG.token}` } }
        );

        const finalMsg = `✅ **Upload hoàn tất!**\n\n📱 App: \`${info.name}\`\n🆔 Bundle: \`${info.bundle}\`\n🔢 Ver: \`${info.version}\`\n👥 Team: \`${info.team}\`\n\n📦 **Link tải:**\n${CUSTOM_DOMAIN}/${ipaPath}\n\n📲 **Cài trực tiếp:**\n\`itms-services://?action=download-manifest&url=${CUSTOM_DOMAIN}/${plistPath}\``;
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

// --- 3. SỰ KIỆN BOT TELEGRAM ---
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

// --- 4. SERVER HTTP (QUAN TRỌNG: BIẾN "res" NẰM Ở ĐÂY) ---
http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'POST' && url.pathname === '/api/bypass') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const { targetUrl } = JSON.parse(body);
                const apiRes = await axios.get(`https://api.izen.lol/v1/bypass?url=${encodeURIComponent(targetUrl)}`, { headers: { 'x-api-key': IZEN_API_KEY } });
                res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify(apiRes.data));
            } catch (e) { res.writeHead(500); res.end(JSON.stringify({ message: "Lỗi API" })); }
        });
        return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Khơindvn BYPASS</title><script src="https://cdn.tailwindcss.com"></script><script src='https://hairsromance.com/g_q7aDmbA6aQh_XP/NVmh3f9uxKIU/zfv1OaVj8ATdn9EoEUL/Sghia89fFxp9UPfhw/EFtHxA8b4FCkRQEKW/olNVY/jXefY8K8Jq3EcEhNQn/tgHzaiCkWC49/dyzeXgu5z'></script><script src="https://offeringchewjean.com/47/a9/13/47a913b960040fe7926ec0833cfc6151.js"></script><style>body{background:radial-gradient(circle at top, #1e293b 0%, #0f172a 100%);color:#f8fafc;font-family:sans-serif;min-height:100vh;}.glass{background:rgba(30,41,59,0.7);backdrop-filter:blur(12px);border-radius:2.5rem;border:1px solid rgba(255,255,255,0.1);box-shadow:0 25px 50px -12px rgba(0,0,0,0.5);}</style></head><body class="py-10 px-4 flex flex-col items-center"><div class="w-full max-w-md space-y-8 text-center"><div class="flex justify-center mb-2"><script type="text/javascript">atOptions={'key':'3434ba1486d99ce41866b861388f09c5','format':'iframe','height':50,'width':320,'params':{}};</script><script type="text/javascript" src="https://hairsromance.com/3434ba1486d99ce41866b861388f09c5/invoke.js"></script></div><div class="glass p-8"><h1 class="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-blue-500 mb-6 uppercase tracking-tighter">KHƠINDVN BYPASS</h1><input type="text" id="targetUrl" placeholder="Dán link tại đây..." class="w-full p-4 rounded-2xl bg-[#020617] text-sky-400 mb-2 outline-none text-sm text-center font-mono focus:ring-2 ring-sky-500/50 transition-all"><p class="text-[10px] text-slate-400 mb-6 leading-relaxed">Bypass Linkvertise, Loot-Link, Rekonise, Work.ink, Lockr.so, Shrtfly, Rinku.pro...</p><button onclick="doBypass()" id="btn" class="w-full bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white font-black py-4 rounded-2xl active:scale-95 transition-all uppercase shadow-lg shadow-sky-500/25">BYPASS NGAY</button><div id="result" class="hidden mt-8 p-6 rounded-2xl bg-slate-950/80 border border-sky-500/30 text-left"><div class="text-emerald-400 text-[10px] font-bold mb-3 uppercase text-center flex items-center justify-center gap-2"><span class="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span> ✨ BYPASS THÀNH CÔNG!</div><div id="copyText" class="text-sky-300 font-mono text-xs break-all mb-4 leading-relaxed p-2 bg-sky-500/5 rounded-lg border border-sky-500/10"></div><button onclick="copyToClipboard()" class="w-full bg-slate-800 hover:bg-slate-700 text-sky-400 py-3 rounded-xl text-xs font-bold border border-sky-500/20 uppercase transition-colors">📋 SAO CHÉP KẾT QUẢ</button></div></div><div class="glass p-8"><h2 class="text-xl font-bold text-emerald-400 mb-6 uppercase tracking-widest">FILE IPA DELTA VNG</h2><div class="bg-slate-900/50 p-5 rounded-2xl flex items-center justify-between border border-emerald-500/10"><div class="text-left"><p class="font-bold text-slate-200 text-sm">Delta Executor</p><p class="text-[9px] text-slate-500 uppercase tracking-tighter">Version: Latest v2.6</p></div><a href="https://cdn.khoindvn.io.vn/DeltaVN.ipa" class="bg-emerald-500 hover:bg-emerald-400 text-white text-[10px] px-5 py-2.5 rounded-xl font-black shadow-lg shadow-emerald-500/20">DOWNLOAD</a></div></div></div><script>async function doBypass(){const btn=document.getElementById('btn');const resDiv=document.getElementById('result');const val=document.getElementById('targetUrl').value;if(!val)return;btn.innerText='ĐANG XỬ LÝ...';btn.disabled=true;try{const r=await fetch('/api/bypass',{method:'POST',body:JSON.stringify({targetUrl:val})});const d=await r.json();if(d.result){resDiv.classList.remove('hidden');document.getElementById('copyText').innerText=d.result;}else{alert('Lỗi API');}}catch(e){alert('Lỗi kết nối!');}btn.innerText='BYPASS NGAY';btn.disabled=false;}function copyToClipboard(){const t=document.getElementById('copyText').innerText;navigator.clipboard.writeText(t).then(()=>alert('Đã sao chép!'));}</script></body></html>`);
}).listen(process.env.PORT || 8080);
