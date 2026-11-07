import sys
f=sys.argv[1]; s=open(f).read()
base='<script>window.MCC_BASE=localStorage.getItem("mcc_base")||"";</script>'
assert s.count('<body>')==1; s=s.replace('<body>','<body>'+base)
gear=('<div onclick="if(confirm(\'Change Command Center server? You will re-enter the address.\'))'
      '{localStorage.removeItem(\'mcc_base\');location.replace(\'index.html?setup=1\')}" '
      'style="position:fixed;bottom:8px;left:8px;z-index:9999;opacity:.35;font-size:14px;color:#a0aec0">&#9881;</div>')
assert s.count('</body>')==1; s=s.replace('</body>',gear+'</body>')
open(f,'w').write(s)
