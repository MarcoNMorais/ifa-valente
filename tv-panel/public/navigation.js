document.getElementById('logout').onclick=async()=>{await fetch('/TV/api/logout',{method:'POST',headers:{'X-TVHosp-Request':'1'}});location.href='/TV';};
