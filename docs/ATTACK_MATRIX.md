# 1~11단계 정상·금지 요청 실측표

이 표는 **직접 보낸 요청의 실제 결과만** 적습니다. 심판의 판정이 아니며, 비어 있는 줄은 미실행입니다.
README의 기존 「사용자 확인」 기록은 요청 ID·시각이 없어 이 표의 실측으로 세지 않습니다(재측정 필요). 로컬 가상 요청 시험(`npm run decider:test` 등)은 API 응답이 아니므로 「실제 API 결과」 칸을 `해당 없음`으로 두고, 통과로 세지 않습니다.

## 한 줄 기록 절차 (요청마다)

1. 브라우저에서 배포 주소를 열고 **F12 → Network** 탭을 켠 뒤 **Preserve log**를 체크합니다.
2. 요청을 보냅니다. 정상 요청은 화면의 버튼으로, 로그인이 필요한 금지 요청은 아래 「로그인 요청 보내기」로, 비로그인 요청은 **시크릿 창**에서 합니다.
3. Network에서 그 요청을 클릭합니다.
   - **실제 API 결과**: 상태 코드와 JSON의 `error` 값(예: `401 UNAUTHORIZED`). 응답 본문·메모 내용은 적지 않습니다.
   - **요청 ID**: Response Headers의 `x-vercel-id` 값.
   - **확인 시각**: Response Headers의 `date`(UTC)를 KST로 바꿔 적거나, 보낸 직후 시계 시각을 적습니다. 시간대를 함께 적습니다.
4. **상태** 칸: 기대 결과와 실제 결과가 같고 요청 ID·시각이 모두 있을 때만 `통과`, 다르면 `실패`(첫 실제 결과를 그대로 적음), 하나라도 비면 `미실행`으로 둡니다. 다른 줄의 결과를 복사하거나 로컬 시험으로 대신하지 않습니다.
5. 한 단계의 정상 줄과 금지 줄이 **모두** `통과`일 때만 그 단계를 완료로 셉니다.

### 로그인 요청 보내기 (토큰 보호)

- 이 앱은 로그인 토큰을 메모리에만 두므로 콘솔에서 저장소를 읽어 요청을 만들 수 없습니다.
- 정상 요청은 화면 버튼으로 보내고 Network에서 읽습니다.
- 화면에 버튼이 없는 금지 요청(남의 메모 ID, `owner_id` 변경, 미승인 기기)은 같은 종류의 정상 요청을 Network에서 우클릭 → **Copy → Copy as fetch**로 복사해 **콘솔에만** 붙여 경로·메서드·본문을 바꿔 보냅니다.
- 복사한 내용에는 토큰이 들어 있습니다. 이 표, README, Git, 채팅에 붙여 넣지 말고 확인이 끝나면 창을 닫으세요.
- 요청에 쓰는 메모 ID는 가상 메모의 ID만, 표에는 앞 8자리만 적습니다. 계정 UID와 이메일은 적지 않습니다.

## 실측표

`A`·`B`는 시험 계정입니다. 「기기 승인」이 필요한 줄은 해당 기기를 승인한 뒤 「승인 확인」으로 받은 15분 토큰 상태에서 보냅니다.

| 번호 | 단계 | 구분 | 요청 | 기대 결과 | 실제 API 결과 | 요청 ID | 확인 시각 | 상태 |
|---|---|---|---|---|---|---|---|---|
| M01 | 1~2 | 금지 | 비로그인 `GET /data.json` | 404 | 404 Not Found | icn1::ltcqz-1795567501478-50a81d87e828 | 2026-11-25 00:45:01 UTC (09:45:01 KST) | 통과 |
| M02 | 2 | 금지 | 비로그인 `GET /api/notes` | 401 JSON 오류, 자료 없음 | 401 UNAUTHORIZED | icn1::iad1::pkvqk-1795567502204-b47366f820ea | 2026-11-25 00:45:02 UTC (09:45:02 KST) | 통과 |
| M03 | 3 | 금지 | 비로그인 `POST /api/notes` | 401 | 401 UNAUTHORIZED | icn1::iad1::zc29m-1795567503402-9e272fa4c1ca | 2026-11-25 00:45:03 UTC (09:45:03 KST) | 통과 |
| M04 | 3 | 금지 | 비로그인 `GET /api/notes/:id` | 401 | 401 UNAUTHORIZED | icn1::iad1::hhrms-1795567504015-0d7309072c3f | 2026-11-25 00:45:04 UTC (09:45:04 KST) | 통과 |
| M05 | 3 | 금지 | 비로그인 `PUT /api/notes/:id` | 401 | 401 UNAUTHORIZED | icn1::iad1::ltcqz-1795567505235-e5c3a6cc7031 | 2026-11-25 00:45:05 UTC (09:45:05 KST) | 통과 |
| M06 | 3 | 금지 | 비로그인 `DELETE /api/notes/:id` | 401 | 401 UNAUTHORIZED | icn1::iad1::phzcn-1795567505838-7508e467d4ef | 2026-11-25 00:45:05 UTC (09:45:05 KST) | 통과 |
| M07 | 3 | 정상 | A: 자기 메모 `POST /api/notes` | 201 | | | | 실행(메모생성) |
| M08 | 3 | 정상 | A: 그 메모 `GET /api/notes/:id` | 200 | | | | 실행(메모수정 누른 후 devtool에서 uid -> headers에서 api/notes/:id 확인 및 x-vercel-id = icn1::iad1::6djd7-1795569345253-9e7a2c0dadd1 확인, date = Wed, 25 Nov 2026 01:15:46 GMT) |
| M09 | 3 | 정상 | A: 그 메모 `PUT /api/notes/:id` | 200 | | | | 200 확인, x-vercel-id : icn1::iad1::xls9p-1795569620082-b455ae1a9eb0, date = Wed, 25 Nov 2026 01:20:21 GMT|
| M10 | 3 | 정상 | A: 그 메모 `DELETE /api/notes/:id` | 204 | | | | 204 DELETE 확인, x-vercel-id : icn1::iad1::xjrgd-1795569776304-7b77441fc377, date = Wed, 25 Nov 2026 01:22:57 GMT|
| M11 | 3 | 정상 | A: 삭제한 메모 `GET /api/notes/:id` | 404 | | | | 삭제 시 204였던 요청을 copy -> console에 붙여넣고 method를 GET으로 변경 -> GET 404 확인 |
| M12 | 4 | 금지 | B: A의 메모 `GET /api/notes/:id` | 404, A 메모 보존 | | | | B 계정 로그인 후 메모 생성, 수정 단계에서 copy as fetch -> console에서 fetch의 원래 B 계정 메모를 A 계정의 메모 id로 변경 -> GET 404 확인 후 A메모 보존 확인   |
| M13 | 4 | 금지 | B: A의 메모 `PUT /api/notes/:id` | 404, A 메모 보존 | | | | 404 확인, 기존 B 메모 생성 -> copyu as fetch 후, console -> method put 변경, body 에 A 메모 삽입, content-type:application/json 삽입, fetch url 맨 뒤에 A 메모 id 삽입 A메모 보존 확인|
| M14 | 4 | 금지 | B: A의 메모 `DELETE /api/notes/:id` | 404, A 메모 보존 | | | | 404 확인, B 계정 로그인 후 B의 GET 요청을 copy as fetch -> console에서 method를 DELETE, fetch url 맨 뒤를 A 메모 id로 변경 -> DELETE 404 확인 (x-vercel-id·date 미기재). 첫 시도는 만료된 기기 토큰으로 403이 나와 「승인 확인」 뒤 새로 복사해 재시도 |
| M15 | 4 | 금지 | A: 자기 메모 `PUT`에 `owner_id`를 B로 | 403 `OWNER_CHANGE_FORBIDDEN` | | | | 403 OWNER_CHANGE_FORBIDDEN 확인, A 계정 로그인 후 자기 메모(1b962cf1…)의 PUT을 copy as fetch -> console에서 body에 가상 owner_id(22222222…) 추가 -> PUT 403 확인 (x-vercel-id·date 미기재) |
| M16 | 4 | 정상 | A: 위 시험 뒤 자기 메모 `GET /api/notes/:id` | 200, 소유자 그대로 | | | | A 계정 로그인 후 M12~M14를 시도한 A 메모가 모두 남아 있음을 화면에서 확인 (상태 코드·x-vercel-id·date 미기재) |
| M17 | 5 | 금지 | 공개 anon 키로 원본 `training_user_notes` 직접 요청 | 자료 없이 거부 | 401 permission denied (42501), 자료 없음 | sb-request-id 01a21029-e3f3-7a8e-965b-d95fad9c2ea8 | 2026-11-25 00:45:11 UTC (09:45:11 KST) | 통과 |
| M18 | 5 | 정상 | A: 서버 경유 `GET /api/notes` | 200, A 메모만 | | | | 200 OK, Wed, 25 Nov 2026 02:11:48 GMT 메모 3건 확인.|
| M19 | 6 | 정상 | 로컬 `decider:test`: 등록 기기 가상 요청 | `allow` | 해당 없음 (로컬 가상 요청) | 해당 없음 | | 로컬 가상 요청 통과 확인: `npm.cmd run decider:test` 출력 `통과 · 등록 기기의 정상 요청` (실행 시각 미기재, API 응답·심판 판정 아님) |
| M20 | 6 | 금지 | 로컬 `decider:test`: 미등록 기기 가상 요청 | `deny` | 해당 없음 (로컬 가상 요청) | 해당 없음 | | 로컬 가상 요청 통과 확인: `npm.cmd run decider:test` 출력 `통과 · 미등록 기기의 가상 요청` (실행 시각 미기재, API 응답·심판 판정 아님) |
| M21 | 7 | 정상 | 로컬 `fixture:7`: 정상 사건 | `allow` | 해당 없음 (로컬 가상 요청) | 해당 없음 | | 로컬 가상 요청 통과 확인: `npm run fixture:7` 출력 `정상 사건: allow` (실행 시각 미기재, API 응답·심판 판정 아님) |
| M22 | 7 | 금지 | 로컬 `fixture:7`: 복합 이상 사건 | `step_up` | 해당 없음 (로컬 가상 요청) | 해당 없음 | | 로컬 가상 요청 통과 확인: `npm run fixture:7` 출력 `복합 이상 사건: step_up` (실행 시각 미기재, API 응답·심판 판정 아님) |
| M23 | 8 | 정상 | A: `GET /api/notices` | 200 | | | | 200 확인, A 로그인 후 GET /api/notes를 copy as fetch -> console에서 url을 /api/notices로 변경 -> GET 200 확인 icn1::iad1::kwkn7-1795573428216-e097725b036c, Wed, 25 Nov 2026 02:23:49 GMT |
| M24 | 8 | 금지 | 비로그인 `GET /api/notices` | 401 | 401 UNAUTHORIZED | icn1::iad1::mvgfg-1795567506453-40a6f1281262 | 2026-11-25 00:45:07 UTC (09:45:07 KST) | 통과 |
| M25 | 8 | 금지 | A: `POST /api/notices` | 405 | | | | 405 Method Not Allowed 확인, 같은 복사본에서 method를 POST로 변경 -> POST /api/notices 405 확인 icn1::iad1::rdmlf-1795573469210-0edcfdab807c, Wed, 25 Nov 2026 02:24:29 GMT |
| M26 | 8 | 금지 | 로컬 `decider.test`: 메모 전체 목록·공지 쓰기·강사 자료 | `deny` | 해당 없음 (로컬 가상 요청) | 해당 없음 | | 로컬 가상 요청 통과 확인: `node --test test/decider.test.mjs` pass 7 (실행 시각 미기재, API 응답·심판 판정 아님) |
| M27 | 9 | 정상 | 로컬 `detect:test`: 120건 이하 조회 | `observe` | 해당 없음 (로컬 가상 사건) | 해당 없음 | | 로컬 가상 사건 통과 확인: `npm.cmd run detect:test` 출력 `통과 · 10분 안에 120건`, `통과 · 정상 조회 30건` (실행 시각 미기재, 실제 접속 회수·심판 판정 아님) |
| M28 | 9 | 금지 | 로컬 `detect:test`: 121건 이상 조회 | `propose_revocation` | 해당 없음 (로컬 가상 사건) | 해당 없음 | | 로컬 가상 사건 통과 확인: `npm.cmd run detect:test` 출력 `통과 · 10분 안에 121건`, `통과 · 폭주 조회 200건` (실행 시각 미기재, 실제 접속 회수·심판 판정 아님) |
| M29 | 10 | 정상 | B: `POST /api/restore/b10c…b1` | 200, `restored: true`, 해시 일치 | 200 · restored: true · ownerMatched: true | icn1::iad1::gnmlc-1795573803058-a064c6616411 | 2026-11-25 02:30:04 UTC (11:30:04 KST) | 통과 |
| M30 | 10 | 금지 | 비로그인 `POST /api/restore/b10c…b1` | 401 | 401 UNAUTHORIZED | icn1::iad1::ltcqz-1795567507707-376856271168 | 2026-11-25 00:45:08 UTC (09:45:08 KST) | 통과 |
| M31 | 10 | 금지 | A: `POST /api/restore/b10c…b1` (B의 메모) | 404, B 메모 변화 없음 | 404 NOT_FOUND | icn1::iad1::wn9jh-1795574027442-f16f47b445b1 | 2026-11-25 02:33:48 UTC (11:33:48 KST) | 통과: 위 404 뒤 B 로그인으로 GET /api/notes/b10c…b1 → 200 OK 확인 (x-vercel-id icn1::iad1::lq8xr-1795574204986-204e0c18d350, 2026-11-25 02:36:47 UTC / 11:36:47 KST). 제목·본문이 사본과 같은지는 미확인 |
| M32 | 11 | 금지 | 비로그인 `POST /api/device/challenge` | 401 | 401 UNAUTHORIZED | icn1::iad1::n64h6-1795567508936-0df4723eafc6 | 2026-11-25 00:45:09 UTC (09:45:09 KST) | 통과 |
| M33 | 11 | 금지 | A: 기기 미승인(대기) 상태에서 `GET /api/notes` | 403 `DEVICE_NOT_APPROVED` | | | | 403 DEVICE_NOT_APPROVED 확인, 승인 상태에서 복사한 GET /api/notes를 SQL로 기기를 pending으로 바꾼 뒤 console에서 재실행 (x-vercel-id·date 미기재) |
| M34 | 11 | 정상 | A: 기기 승인 + 「승인 확인」 뒤 `GET /api/notes` | 200 | 200 OK | icn1::iad1::xjrgd-1795574354337-e6738131ea9d | 2026-11-25 02:39:14 UTC (11:39:14 KST) | 통과 |
| M35 | 11 | 금지 | A: 기기 `revoked` 뒤 `GET /api/notes` | 403 `DEVICE_NOT_APPROVED` (상태 `revoked`) | 403 (기기를 revoked로 바꾼 뒤 같은 복사본 재실행) | icn1::iad1::z5hdc-1795574684238-75e9614713cb | 2026-11-25 02:44:45 UTC (11:44:45 KST) | 통과 (오류 이름은 미기재, 403 확인) |

## 집계 (표를 채울 때마다 다시 셉니다)

- 실측 통과: 10줄 / 전체 35줄 (M01~M06, M17, M24, M30, M32: 2026-11-25 이 PC의 `curl`로 배포 주소에 직접 보낸 비로그인 요청. 브라우저 Network가 아님)
- 로컬 가상 요청(API 응답 아님, 실측 통과로 세지 않음): M19~M22, M26~M28
- 단계별 완료: 정상·금지 줄이 모두 통과한 단계만 적습니다. 현재 없음 (금지 줄만 통과, 각 단계의 정상 줄이 아직 미실행).
- 한 번 `실패`한 줄은 원인을 고친 뒤 다시 보내고, 새 요청 ID·시각으로 덮어쓰기 전에 실패 기록을 이 표 아래에 한 줄 남깁니다.
