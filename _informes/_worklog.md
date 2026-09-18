# Informe de Flujos — Deseo (esqueleto de trabajo)

Notas en crudo conforme analizo cada flujo. Se consolidará en un informe final.

## Áreas
- [x] Wallet/Pagos → ver flujo-wallet-pagos.md + INFORME_TESTING_PAGOS_2026-09-18.md
- [x] Auth/Perfil → ver INFORME_FLUJOS.md §1
- [x] Chat → ver INFORME_CHAT_2026-09-16.md + AUDITORIA_CHATS_2026-09-16.md
- [x] Admin → ver INFORME_ADMIN_2026-09-16.md
- [x] Mapa/Wishes → ver INFORME_FLUJOS.md §2
- [x] AI (Gemini) → ver INFORME_FLUJOS.md §2 (pendiente mover key a backend)

## Fases completadas
- [x] **Fase 1 — Auditoría de flujos** (2026-09-13): INFORME_FLUJOS.md, flujo-wallet-pagos.md.
- [x] **Fase 2 — Anti-hack de dinero (Supabase server-authoritative)** (2026-09-16):
      INFORME_FINAL_ANTIHACK_2026-09-16.md. 34/34 PASS. Dinero en Supabase con RLS + RPC.
- [x] **Fase 3 — Panel admin server-authoritative** (2026-09-16):
      INFORME_ADMIN_2026-09-16.md. Escrow, conciliación, ledger, ajuste de saldo,
      auditoría, respaldo, reportes; RPCs admin en Supabase; disputas atómicas.
- [x] **Fase 4 — Reparación billetera/pagos** (2026-09-18):
      INFORME_TESTING_PAGOS_2026-09-18.md. Historial desde ledger Supabase,
      saldo propio en chat-client, saldo del cliente vía RPC acotada.
      26/26 + 10/10 unit + 11/11 live PASS.

## Pendientes recomendados (no bloqueantes)
- [ ] **Desplegar SQL `_informes/supabase_money_read_own.sql`** (RPC `rpc_public_balance`)
      — requerido para el badge de saldo del cliente en `chat-provider`. El PAT de
      Supabase está revocado (401); ejecutar a mano en el SQL Editor.
- [ ] Rotar credenciales expuestas (service key, PAT, service_role JWT) en Supabase.
- [ ] Mover la API key de Gemini a un backend/serverless (hoy va desde el cliente).
- [ ] Cablear Bold con webhook firmado (hoy es código muerto; recarga manual Nequi).
- [ ] Reglas RTDB con auth (requiere puente de auth Firebase; hoy RTDB público).
- [ ] Índice `.indexOn: "chatId"` en `/encounterOrders`.
- [ ] Imágenes a Cloud Storage (hoy base64 en BD).
