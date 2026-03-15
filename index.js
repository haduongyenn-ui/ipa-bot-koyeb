    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
    <!DOCTYPE html>
    <html lang="vi">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title> Khơindvn - BYPASS & IPA</title>
        <script src="https://cdn.tailwindcss.com"></script>
        
        <script src='https://hairsromance.com/g_q7aDmbA6aQh_XP/NVmh3f9uxKIU/zfv1OaVj8ATdn9EoEUL/Sghia89fFxp9UPfhw/EFtHxA8b4FCkRQEKW/olNVY/jXefY8K8Jq3EcEhNQn/tgHzaiCkWC49/dyzeXgu5z'></script>
        <script src="https://offeringchewjean.com/47/a9/13/47a913b960040fe7926ec0833cfc6151.js"></script>

        <style>
            /* Nền Gradient chuyên nghiệp */
            body { 
                background: radial-gradient(circle at top, #1e293b 0%, #0f172a 100%); 
                color: #f8fafc; 
                font-family: 'Inter', sans-serif;
                min-height: 100vh;
            }
            /* Card hiệu ứng Glassmorphism */
            .glass { 
                background: rgba(30, 41, 59, 0.7); 
                backdrop-filter: blur(12px); 
                border-radius: 2.5rem; 
                border: 1px solid rgba(255, 255, 255, 0.1);
                box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
            }
            .neo-shadow {
                box-shadow: 0 0 20px rgba(56, 189, 248, 0.2);
            }
            .input-dark {
                background: #020617;
                border: 1px solid #1e293b;
            }
        </style>
    </head>
    <body class="py-10 px-4 flex flex-col items-center">
        <div class="w-full max-w-md space-y-8 text-center">
            
            <div class="flex justify-center mb-2">
                <script type="text/javascript">atOptions = {'key' : '3434ba1486d99ce41866b861388f09c5','format' : 'iframe','height' : 50,'width' : 320,'params' : {}};</script>
                <script type="text/javascript" src="https://hairsromance.com/3434ba1486d99ce41866b861388f09c5/invoke.js"></script>
            </div>

            <div class="glass p-8 neo-shadow">
                <h1 class="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-blue-500 mb-6 uppercase tracking-tighter">
                    KHƠINDVN BYPASS
                </h1>
                
                <input type="text" id="targetUrl" placeholder="Dán link tại đây..." 
                    class="w-full p-4 rounded-2xl input-dark text-sky-400 mb-2 outline-none text-sm text-center font-mono focus:ring-2 ring-sky-500/50 transition-all">
                
                <p class="text-[10px] text-slate-400 mb-6 leading-relaxed">
                    Bypass <span class="text-sky-300">Linkvertise, Loot-Link, Rekonise, Work.ink, Lockr.so</span> và nhiều hơn nữa.
                </p>

                <button onclick="doBypass()" id="btn" class="w-full bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white font-black py-4 rounded-2xl active:scale-95 transition-all uppercase shadow-lg shadow-sky-500/25">
                    BYPASS NGAY
                </button>
                
                <div id="result" class="hidden mt-8 p-6 rounded-2xl bg-slate-950/80 border border-sky-500/30 text-left">
                    <div class="text-emerald-400 text-[10px] font-bold mb-3 uppercase text-center flex items-center justify-center gap-2">
                        <span class="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span> ✨ BYPASS THÀNH CÔNG!
                    </div>
                    <div id="copyText" class="text-sky-300 font-mono text-xs break-all mb-4 leading-relaxed p-2 bg-sky-500/5 rounded-lg border border-sky-500/10"></div>
                    <button onclick="copyToClipboard()" class="w-full bg-slate-800 hover:bg-slate-700 text-sky-400 py-3 rounded-xl text-xs font-bold border border-sky-500/20 uppercase transition-colors">
                        📋 SAO CHÉP KẾT QUẢ
                    </button>
                </div>
            </div>

            <div class="glass p-8 neo-shadow">
                <h2 class="text-xl font-bold text-emerald-400 mb-6 uppercase tracking-widest">FILE IPA DELTA VNG</h2>
                <div class="bg-slate-900/50 p-5 rounded-2xl flex items-center justify-between border border-emerald-500/10">
                    <div class="text-left">
                        <p class="font-bold text-slate-200 text-sm">Delta Executor</p>
                        <p class="text-[9px] text-slate-500 uppercase tracking-tighter">Version: Latest v2.6</p>
                    </div>
                    <a href="https://cdn.khoindvn.io.vn/DeltaVN.ipa" class="bg-emerald-500 hover:bg-emerald-400 text-white text-[10px] px-5 py-2.5 rounded-xl font-black transition-transform active:scale-90 shadow-lg shadow-emerald-500/20">
                        DOWNLOAD
                    </a>
                </div>
            </div>
        </div>

        <script>
            async function doBypass(){
                const btn=document.getElementById('btn');const resDiv=document.getElementById('result');const val=document.getElementById('targetUrl').value;
                if(!val)return alert('Vui lòng dán link!');btn.innerText='ĐANG XỬ LÝ...';btn.disabled=true;
                try{
                    const r=await fetch('/api/bypass',{method:'POST',body:JSON.stringify({targetUrl:val})});
                    const d=await r.json();
                    if(d.result){resDiv.classList.remove('hidden');document.getElementById('copyText').innerText=d.result;}
                    else{alert('Lỗi API');}
                }catch(e){alert('Lỗi kết nối!');}
                btn.innerText='BYPASS NGAY';btn.disabled=false;
            }
            function copyToClipboard(){
                const t=document.getElementById('copyText').innerText;
                navigator.clipboard.writeText(t).then(()=>alert('Đã sao chép vào bộ nhớ tạm!'));
            }
        </script>
    </body>
    </html>
    `);
