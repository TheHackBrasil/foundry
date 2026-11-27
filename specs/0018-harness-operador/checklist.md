# Checklist: Spec 0017: dados pessoais, superfície nova e simulação

Checklist avalia a qualidade dos requisitos (a spec), não o código.
Áreas de risco: dados pessoais de contatos e gravações (A5 e LGPD),
superfície nova com escrita e webhooks (A2/A4), material simulado (A7) e
afirmação factual sobre fornecedores (A7).

## Requisitos: completude

- [x] CHK001 Todo RF é verificável por comando ou inspeção direta? Os critérios de sucesso pedem teste automatizado para idempotência, aprovação, destinos, MCP e payload (`spec.md:152-162`); RF16 tem as frases obrigatórias verificáveis no roteiro (`spec.md:95`).
- [x] CHK002 Fora de escopo fecha as brechas óbvias? Proíbe contato fora do time sem parecer, escrita por agente externo, negociação e portal com credencial (`spec.md:17-25`).
- [x] CHK003 Nenhum `[NEEDS CLARIFICATION]` restante sem resposta? Nenhum; as respostas do clarify de 26/11 estão em `spec.md:175`, e os dois pontos técnicos viram spikes T701 e T703.

## Área de risco: dados pessoais e gravações

- [x] CHK010 A spec trata áudio, transcrição e telefone como dados pessoais, fora do repo e com retenção? Sim, 90 dias (`spec.md:128`).
- [x] CHK011 A spec impede que dado pessoal entre no ledger imutável ou no comprovante público? Sim (`spec.md:110`, RF25, e `spec.md:149`, invariante 6).
- [x] CHK012 A spec limita quem pode ser contatado? Workspace habilitado, destino na lista e contato manual (`spec.md:84`, RF8, e `spec.md:147`, invariante 4).
- [x] CHK013 A spec impede contato fora do time na demo? Sim (`spec.md:20`).
- [x] CHK014 A spec exige identificação como assistente virtual, aviso de gravação e opt-out? Sim (`spec.md:95`, RF16).
- [x] CHK015 O consentimento das pessoas do time e a transferência internacional aparecem? Sim (`spec.md:128`).

## Área de risco: superfície nova e escrita

- [x] CHK020 Aprovação exige credencial e trata corrida (prazo, duplo clique, caso fechado)? Sim (`spec.md:87`, RF11).
- [x] CHK021 Webhook exige assinatura, janela, dedupe e mapeamento pelo id externo? Sim (`spec.md:96`, RF17).
- [x] CHK022 O MCP é só de leitura, em lista fechada e preso a caso e tentativa? Sim (`spec.md:103`, RF21, e `spec.md:146`, invariante 3).
- [x] CHK023 WhatsApp e ligação exigem aprovação válida da versão atual? Sim (`spec.md:145`, invariante 2).
- [x] CHK024 Conteúdo de canal entra como dado e nunca vira roteiro ou instrução? Sim (`spec.md:95`, RF16, e `spec.md:105`, RF23).
- [x] CHK025 Falha ambígua não repete ação irreversível? Sim (`spec.md:91`, RF12).
- [x] CHK026 Há como parar tudo? Kill switch global e por workspace (`spec.md:86`, RF10).

## Área de risco: simulação e afirmação factual (A7)

- [x] CHK030 A transportadora simulada é rotulada? Sim (`spec.md:116`, RF28, e `spec.md:130`).
- [x] CHK031 O relatório do teste de voz sai rotulado como teste? Sim (`spec.md:117`, RF29).
- [x] CHK032 Preço ou latência de fornecedor aparecem como medidos? Não: a medição vem só da bancada (`spec.md:117`).
- [x] CHK033 Afirmação sobre fornecedor tem fonte? ElevenLabs, Retell, Telnyx, DBOS e Turso com link nas Premissas (`spec.md:167-169`); o áudio da TOTVS está marcado como transcrição fora do repo (`spec.md:11`).

## Veredito

- [x] Spec apta para `plan` depois do aceite do usuário: marcadores zerados. O `plan.md` e o `tasks.md` existentes foram escritos antes do clarify e precisam ser revistos contra esta versão (ver `revisao-e-proximos-passos.md`).
