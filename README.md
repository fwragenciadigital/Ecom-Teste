# BotBet Monitor

Monitor de jogos gratuito: o coletor Python consulta a Football-Data.org, aplica as regras e publica o resultado no Worker. O Worker mantém o painel e dispara o Telegram. Não há API de odds no fluxo: a odd deve ser conferida manualmente antes de qualquer decisão.

## Critérios aplicados

- Favorito definido pela maior pontuação na tabela, com distância mínima de 6 pontos.
- Últimos 5 do favorito no mesmo mando (casa ou fora): no máximo 1 derrota e 1 empate.
- Últimos 5 do não favorito no mando complementar: no máximo 1 vitória e, no mínimo, 3 derrotas.
- A partida precisa estar no calendário do dia e ter tabela e histórico suficientes.
- O painel e o Telegram exibem o favorito sugerido; confira se a odd 1X2 está abaixo de 1,80 manualmente.

## Arquitetura sem assinatura

| Parte | Serviço | Função |
| --- | --- | --- |
| Coleta | GitHub Actions + Python | Executa três vezes por dia. |
| Estatísticas | Football-Data.org | Calendário, tabela e resultados. |
| Painel e alertas | Cloudflare Worker + KV | Exibe os jogos aprovados e envia Telegram. |
| Aviso | Telegram Bot API | Entrega o alerta privado. |

O pacote inicia com Premier League, La Liga, Serie A, Bundesliga e Brasileirão Série A. Edite `BOTBET_LEAGUES` em `.github/workflows/soccerdata-collect.yml` para ampliar as ligas depois de validar a coleta.

## Publicação do Worker

1. Instale e autentique o Wrangler:

   `npm install -g wrangler && wrangler login`

2. Confirme o KV `STATE` em `wrangler.toml` e cadastre os três segredos, sem colocá-los no Git:

   `wrangler secret put TELEGRAM_BOT_TOKEN`

   `wrangler secret put RUN_SECRET`

   `wrangler secret put INGEST_SECRET`

3. Publique:

   `wrangler deploy`

4. Abra o bot no Telegram, envie `/start` e então chame uma vez:

   `curl -H "Authorization: Bearer SEU_RUN_SECRET" https://SEU_WORKER.workers.dev/capture-telegram`

O endereço `GET /health` não exige segredo. O painel está na raiz `/` e os resultados em `/status`.

## Configuração do GitHub Actions

No repositório do GitHub, abra **Settings → Secrets and variables → Actions** e crie:

| Segredo | Valor |
| --- | --- |
| `BOTBET_INGEST_URL` | `https://SEU_WORKER.workers.dev/ingest` |
| `BOTBET_INGEST_SECRET` | o mesmo valor definido como `INGEST_SECRET` no Worker |
| `FOOTBALL_DATA_TOKEN` | token gratuito da Football-Data.org |

Depois acione **Actions → Coletar jogos BotBet → Run workflow**. O campo **Data a consultar** aceita `AAAA-MM-DD`: deixe vazio para hoje ou informe, por exemplo, `2026-09-06` para amanhã. O agendamento usa 05:00, 11:00 e 17:00 UTC; o GitHub pode atrasar alguns minutos tarefas gratuitas. Se a fonte bloquear uma coleta, o resultado falha fechado: não envia jogo sem dados completos.

## Execução local opcional

```bash
FOOTBALL_DATA_TOKEN='seu-token' BOTBET_LEAGUES='PL' python collector/monitor.py
```

Para publicar localmente no Worker, acrescente `BOTBET_INGEST_URL` e `BOTBET_INGEST_SECRET` ao ambiente. O arquivo `collector/latest_run.json` registra o último resultado local.

## Limites e responsabilidade

A Football-Data.org tem plano gratuito com cobertura limitada; mudanças de plano ou de API podem interromper a rotina. O sistema é um filtro estatístico para teste e não prevê resultados nem constitui recomendação de aposta.
