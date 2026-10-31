/* Original login.zip artwork for startup; the existing progress gate remains live. */
(() => {
 const api=window.LoadingDesign={ready:null,source:'login.png',sha256:'0de44785ff137b77ee1eeb74d56199fa679f5ae774173e87fe33d93e9c19af51'};
 const screen=document.getElementById('gameLoading');if(!screen){api.ready=Promise.resolve();return}
 const stage=document.createElement('div');stage.className='loading-reference-stage';
 const image=new Image();image.className='loading-reference-art';image.alt='Shinobi Bombers — Enter the Hidden Village';image.draggable=false;
 api.ready=new Promise((resolve,reject)=>{image.onload=()=>image.naturalWidth===1536&&image.naturalHeight===1024?resolve():reject(Error('Startup reference dimensions changed'));image.onerror=()=>reject(Error('Original startup artwork could not load'))});
 image.src=new URL('../design-v3/ref-login.png',document.currentScript.src).href;stage.append(image);
 const panel=document.createElement('div');panel.className='loading-reference-panel';
 const title=document.createElement('h2');title.textContent='ENTERING THE HIDDEN VILLAGE';
 const copy=document.createElement('p');copy.className='loading-reference-copy';copy.textContent='Preparing your shinobi journey';
 panel.append(title,copy,document.getElementById('loadingStatus'),document.getElementById('loadingProgress'));
 stage.append(panel);screen.append(stage);screen.classList.add('loading-reference-active');
 api.ready.catch(error=>console.error(error.message));
})();
