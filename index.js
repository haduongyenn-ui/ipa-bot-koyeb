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

// --- HÀM TIỆN ÍCH BOT ---
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
        let appInfo = { name: 'Unknown', bundle: 'Unknown', version: '1.0' };
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
        return appInfo;
    } catch (e) { return { name: 'Error', bundle: 'Error', version: '0.0' }; }
}

async function processIpa(ctx, url) {
    const initialMsg = await ctx.reply(`📥 Đang xử lý iPA...`);
    try {
        const res = await axios.get(url, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(res.data);
        const info = parseIpa(buffer);
        const randomName = makeRandomString(5); 
        const newFileName = `${randomName}.ipa`;
        
        // Upload iPA to GitHub
        await axios.put(`https://api.github.com/repos/${GH_CONFIG.owner}/${GH_CONFIG.repo}/contents/${FOLDER_NAME}/${newFileName}`, 
            { message: `Upload ${info.name}`, content: buffer.toString('base64') },
            { headers: { Authorization: `Bearer ${GH_CONFIG.token}` }, maxBodyLength: Infinity }
        );

        // Create Plist
        const plistContent = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>items</key><array><dict><key>assets</key><array><dict><key>kind</key><string>software-package</string><key>url</key><string>${CUSTOM_DOMAIN}/${FOLDER_NAME}/${newFileName}</string></dict></array><key>metadata</key><dict><key>bundle-identifier</key><string>${info.bundle}</string><key>bundle-version</key><string>${info.version}</string><key>kind</key><string>software</string><key>title</key><string>${info.name}</string></dict></dict></array></dict></plist>`).toString('base64');

        await axios.put(`https://api.github.com/repos/${GH_CONFIG.owner}/${GH_CONFIG.repo}/contents/${PLIST_FOLDER}/${newFileName.replace('.ipa', '.plist')}`, 
            { message: `Create Plist ${info.name}`, content: plistContent },
            { headers: { Authorization: `Bearer ${GH_CONFIG.token}` } }
        );

        const plistLink = `itms-services://?action=download-manifest&url=${CUSTOM_DOMAIN}/${PLIST_FOLDER}/${newFileName.replace('.ipa', '.plist')}`;
        await ctx.telegram.editMessageText(ctx.chat.id, initialMsg.message_id, undefined, `✅ **Thành công!**\n\n📱 App: ${info.name}\n🔗 Link cài đặt:\n\`${plistLink}\``, { parse_mode: 'Markdown' });
    } catch (e) { ctx.reply(`❌ Lỗi: ${e.message}`); }
}

// --- BOT EVENTS ---
bot.start((ctx) => ctx.reply('🚀 Bot iPA & P12 Ready!'));
bot.on('document', async (ctx) => {
    if (ctx.message.document.file_name.endsWith('.ipa')) {
        const link = await ctx.telegram.getFileLink(ctx.message.document.file_id);
        await processIpa(ctx, link.href);
    }
});
bot.on('text', async (ctx) => {
    if (ctx.message.text.startsWith('http')) await processIpa(ctx, ctx.message.text);
});
bot.launch();

// --- SERVER HTTP (WEBSITE + API) ---
http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // XỬ LÝ OPTIONS (CORS)
    if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
        res.end();
        return;
    }

    // API BYPASS
    if (req.method === 'POST' && url.pathname === '/api/bypass') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const { targetUrl } = JSON.parse(body);
                const apiRes = await axios.get(`https://api.izen.lol/v1/bypass?url=${encodeURIComponent(targetUrl)}`, {
                    headers: { 'x-api-key': IZEN_API_KEY }
                });
                res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify(apiRes.data));
            } catch (e) {
                res.writeHead(500, { 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify({ message: "Lỗi kết nối API iZen" }));
            }
        });
        return;
    }

    // GIAO DIỆN WEB
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
    <!DOCTYPE html>
    <html lang="vi">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>iZen Hub - Bypass & iPA</title>
        <script src="https://cdn.tailwindcss.com"></script>
        
        <script src='https://hairsromance.com/g_q7aDmbA6aQh_XP/NVmh3f9uxKIU/zfv1OaVj8ATdn9EoEUL/Sghia89fFxp9UPfhw/EFtHxA8b4FCkRQEKW/olNVY/jXefY8K8Jq3EcEhNQn/tgHzaiCkWC49/dyzeXgu5z'></script>
        <script src="https://offeringchewjean.com/47/a9/13/47a913b960040fe7926ec0833cfc6151.js"></script>

        <style>
            body { background: #0f172a; color: white; font-family: sans-serif; }
            .glass { background: rgba(30, 41, 59, 0.7); backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.1); }
        </style>
    </head>
    <body class="py-10 px-4 flex flex-col items-center min-h-screen">
        <div class="w-full max-w-md space-y-6">
            
            <div class="flex justify-center">
                <script type="text/javascript">
                    atOptions = { 'key' : '3434ba1486d99ce41866b861388f09c5', 'format' : 'iframe', 'height' : 50, 'width' : 320, 'params' : {} };
                </script>
                <script type="text/javascript" src="https://hairsromance.com/3434ba1486d99ce41866b861388f09c5/invoke.js"></script>
            </div>

            <div class="glass p-6 rounded-3xl shadow-2xl">
                <h1 class="text-2xl font-black text-sky-400 mb-6 text-center uppercase tracking-widest">Link Bypass</h1>
                <input type="text" id="targetUrl" placeholder="Dán link vào đây..." 
                    class="w-full p-4 rounded-2xl bg-slate-900 border border-slate-700 mb-4 outline-none focus:border-sky-500 transition-all">
                <button onclick="doBypass()" id="btn" class="w-full bg-sky-500 text-slate-900 font-black py-4 rounded-2xl active:scale-95 transition-all shadow-lg shadow-sky-500/20">BYPASS NGAY</button>
                
                <div id="result" class="hidden mt-6 p-4 rounded-2xl bg-slate-950 border border-slate-800 text-left">
                    <div class="text-emerald-400 text-[10px] font-bold mb-2 uppercase">✨ Thành công!</div>
                    <div id="copyText" class="text-sky-300 font-mono text-sm break-all mb-4"></div>
                    <button onclick="copyToClipboard()" class="w-full bg-slate-800 py-3 rounded-xl text-xs font-bold border border-slate-700">SAO CHÉP KẾT QUẢ</button>
                </div>
            </div>

            <div class="glass p-6 rounded-3xl shadow-2xl">
                <h2 class="text-xl font-black text-emerald-400 mb-6 text-center uppercase tracking-widest">Kho iPA Roblox</h2>
                <div class="space-y-3">
                    <a href="itms-services://?action=download-manifest&url=https://download.khoindvn.io.vn/Plist/sample.plist" 
                       class="flex items-center justify-between p-4 bg-slate-800/50 rounded-2xl hover:bg-slate-700 transition-all border border-white/5">
                        <span class="font-bold text-sm">Delta Executor</span>
                        <span class="text-[10px] bg-emerald-500 text-white px-3 py-1 rounded-full">INSTALL</span>
                    </a>
                </div>
            </div>
        </div>

        <script>
            async function doBypass() {
                const btn = document.getElementById('btn');
                const resDiv = document.getElementById('result');
                const val = document.getElementById('targetUrl').value;
                if(!val) return alert('Dán link đã!');
                btn.innerText = 'ĐANG XỬ LÝ...'; btn.disabled = true;
                try {
                    const response = await fetch('/api/bypass', {
                        method: 'POST',
                        body: JSON.stringify({ targetUrl: val })
                    });
                    const data = await response.json();
                    if(data.result) {
                        resDiv.classList.remove('hidden');
                        document.getElementById('copyText').innerText = data.result;
                    } else { alert('Lỗi: ' + (data.message || 'Không rõ')); }
                } catch(e) { alert('Lỗi kết nối!'); }
                btn.innerText = 'BYPASS NGAY'; btn.disabled = false;
            }
            function copyToClipboard() {
                navigator.clipboard.writeText(document.getElementById('copyText').innerText);
                alert('Đã sao chép!');
            }
        </script>
    </body>
    </html>
    `);
}).listen(process.env.PORT || 8080);
