# Transportadoras brasileiras: mapa de rastreio público

Pesquisa de 24/11 para o backlog 32 (alimenta o 33, scraping de status).
Objetivo: a lista-alvo certa antes de qualquer scraper, com a página
pública de rastreio de cada transportadora. A página pública é a versão
da transportadora sobre a entrega e entra na tese de reconciliação como
fonte consultiva.

## Método e honestidade

- Lista compilada por pesquisa web (ranking OTM Maiores do Transporte,
  Valor 1000, Exame Melhores e Maiores, GCCA LatAm, RI de listadas).
- Em 24/11, 20 URLs foram testadas de verdade com `curl -L`
  (`Mozilla/5.0`): 17 responderam HTTP 200. O resultado por URL está na
  coluna "vivo 24/11".
- "Server-rendered" continua inferência pela stack aparente
  (PHP/ASP/WebForms = amigável a regex; SPA = precisa Firecrawl ou
  browser). Não foi inspecionado HTML.
- Posições de mercado de empresas fechadas vêm de fontes secundárias;
  faturamento público confiável não existe para todas.

## Top 5 por cobertura

1. **Correios**: maior capilaridade do país; aceita CPF/CNPJ + código.
   Captcha na página pública.
2. **Braspress**: maior LTL fracionada nacional, ~R$2 bi, 100+ filiais.
   Endpoint GET puro confirmado (abaixo).
3. **Jamef**: top-3 LTL B2B nacional.
4. **Jadlog**: maior courier privado de e-commerce depois dos Correios.
5. **SSW (`ssw.inf.br`)**: TMS usado por centenas de transportadoras
   médias (Alfa, Atlas, Plimor, Transpen, Sudoeste, RedeSul...). Um
   scraper cobre a cauda longa inteira; o multiplicador de cobertura.

## Rodoviário fracionado (LTL)

| Transportadora | URL de rastreio | Código pedido | Vivo 24/11 | Nota |
|---|---|---|---|---|
| Braspress | `braspress.com.br/site/w/tracking/search?cnpj={cnpj}&documentType=NOTAFISCAL&numero={nf}` | CNPJ/CPF + nº NF | 200 | Endpoint GET puro: resposta direta, ideal para regex |
| Jamef | `jamef.com.br/rastrear/` | NF + CPF/CNPJ destinatário | 200 | Provável server-rendered |
| Patrus | `patrus.com.br/rastreie-sua-carga/` | CPF/CNPJ + NF/pedido/CT-e | 403 | Proteção de bot |
| Rodonaves | `rodonaves.com.br/rastreio-de-mercadoria` | CPF/CNPJ + NF ou CT-e | 200 | SPA AngularJS: precisa Firecrawl |
| Expresso São Miguel | `portaldocliente.expressosaomiguel.com.br:2041/track` | CPF/CNPJ destinatário + NF-e ou CT-e | 200 | Usa TMS SSW |
| Translovato | `translovato.com.br/minha-carga/` | CNPJ/CPF + nº NF | 200 | Usa TMS SSW; não aceita nº de pedido |
| Favorita | `cliente.favorita.com.br/rastreamento` | Tipo + nº documento | não testada | Área do cliente |
| Movvi | `movvi.com.br/ferramentas/rastreio` | CNPJ/CPF + NF ou conhecimento | 200 | Página WP com form |
| SSW multi-carrier | `ssw.inf.br/2/rastreamento` e `ssw.inf.br/tracking/destinatario` | CNPJ/CPF remetente + NF, pedido, coleta ou chave NF-e | 200 | PHP legado: regex-friendly; cobre centenas de médias |
| Motiq (sobre SSW) | `rastreio.motiq.com.br` | CNPJ/CPF + NF/pedido/chave NF-e | não testada | Agregador gratuito |

## Rodoviário lotação (FTL) e dedicadas

Quase nada público: JSL (#1 rodoviário do Brasil, ~R$9 bi), Tegma,
Fadel e dedicadas em geral rastreiam por portal de cliente ou EDI B2B.
Não priorizar scraping aqui.

## Last-mile e e-commerce

| Transportadora | URL | Código | Vivo 24/11 | Nota |
|---|---|---|---|---|
| Loggi | `loggi.com/rastreador/` | Código próprio | 200 | SPA React: Firecrawl |
| Anjun | `anjunexpress.com/trackPackage?tracking={cod}` | Código AJ | 200 | GET direto |
| J&T Express | `jtexpress.com.br/trajectoryQuery?type=0&waybillNo={15d}` | Waybill 15d ou CPF | 200 | GET endpoint |
| Total Express | `tracking.totalexpress.com.br/buscar-pedido` | Pedido/AWB + CEP + challenge | 400 | Endpoint existe, exige params; challenge dificulta |
| iMile | `imile.com/BR-pt/track/` | Pedido/remessa | não testada | Tem API REST pública |
| Sequoia | `tnet.sequoialog.com.br/servicos/rastreio.php` | NF/pedido + CPF/CNPJ | não testada | Saiu do e-commerce em reestruturação; rastreio.php é SSR |
| Direct Log | `directlog.com.br` | Remessa/ordem/tracking | não testada | Grupo Americanas |

Envios cativos sem página pública: Mercado Envios, Amazon Logística,
Shopee Xpress. Fora do escopo.

## Courier e encomendas

| Transportadora | URL | Código | Vivo 24/11 | Nota |
|---|---|---|---|---|
| Correios | `rastreamento.correios.com.br/app/index.php` | Código 13c ou CPF/CNPJ | 200 | Captcha de imagem: scraping frágil |
| Jadlog | `jadlog.com.br/tracking` | CPF ou nº remessa 14d | 200 | Java/JSF legado: provável SSR |
| FedEx | `fedex.com/pt-br/tracking.html` | Tracking number | não testada | Tem API pública |
| UPS | `ups.com/track?loc=pt_BR` | Tracking number | não testada | Tem API pública |
| DHL | `dhl.com/br-pt/home/rastreamento.html` | Tracking ID | não testada | Tem API pública |
| TNT Mercúrio | `tnt.com` (ferramentas Mercúrio) | CPF/CNPJ ou NF-e | não testada | Segue ativa sob FedEx |

## Aéreo

| Transportadora | URL | Código | Vivo 24/11 | Nota |
|---|---|---|---|---|
| Latam Cargo | `latamcargo.com/en/trackshipment?docNumber={8d}&docPrefix={prefix}` | AWB prefixo + 8 dígitos | 200 | Rota GET funciona |
| Gollog | `servicos.gollog.com.br/Rastreamento` | AWB 11 dígitos | 200 | Provável SSR |
| Azul Cargo | `azulcargoexpress.com.br/Rastreio` | AWB iniciando 577 | 403 | reCAPTCHA + proteção de bot |
| Modern Logistics | portal My.MODERN | (sem página) | (sem página) | Sem página pública |

## Químico, granel e refrigerado

Setor dedicado e contratual: Cesari, Jaloto, TransJordano (químico) e
Friozem, Comfrio, Emergent Cold (frio) rastreiam por EDI e portal de
cliente, não por página pública. Não priorizar scrapers; Friozem é a
única com massa B2B que valeria revisitar se aparecer em CT-es reais.

## Achados transversais

1. O input quase universal de LTL/courier é **CNPJ/CPF + número da NF**,
   que o produto já extrai. J&T e SSW aceitam **chave NF-e de 44
   dígitos**, que o produto já tem como id de pedido. Last-mile usa
   código proprietário (AWB, waybill, remessa): exige mapear o
   identificador no CT-e ou no pedido.
2. Endpoints GET puros (scraping sem browser): Braspress
   `/site/w/tracking/search`, J&T `/trajectoryQuery`, Anjun
   `/trackPackage`, Latam `/trackshipment`.
3. Captchas reais: Correios, Azul Cargo e Total Express protegem a
   página pública; priorizar os GET puros.
4. SSW generaliza: um parser de `ssw.inf.br` cobre a cauda longa de
   médias transportadoras que nunca teriam scraper próprio.

## Fontes

- Ranking OTM Maiores do Transporte 2024 (abralog.com.br)
- Valor 1000 2024, lista de logísticas (valor.globo.com)
- Exame Melhores e Maiores 2025: JSL ~R$9 bi (exame.com)
- GCCA Latin America Top-10 2025, cadeia fria (gcca.org)
- RI Sequoia, B3 SEQL3 (ri.sequoialog.com.br)
- Documentação SSW em docs.bulkroute.com.br
- Brasil do Trecho: maiores transportadoras (brasildotrecho.com.br)
- CNN Brasil: Grupo Patrus >R$1 bi (cnnbrasil.com.br)
- Help pages de lojistas confirmando formatos de código
