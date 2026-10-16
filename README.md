# Hexle

바다 위에 육각 타일을 붙여 섬을 키우고, 바닷속까지 꾸미는 3D 웹 게임. Three.js + Vite.

**데모**: https://leepillwoo.github.io/Hexle/

## 조작
- 휠 줌 · 좌클릭 드래그 회전 · 우클릭 드래그 이동
- `D` 잠수/수면 · `G` 육각 그리드 · `B` 영역 경계선 · `Esc` 선택 취소
- 왼쪽 패널에서 타일, 오른쪽 패널에서 아이템을 얻고 카드를 고른 뒤 지형을 클릭해 배치

## 개발
```
npm install
npm run dev      # http://localhost:5173
npm run build    # dist/
node src/core/hex.check.ts   # 좌표 수학 자체 검사
npm run check                # 개발 서버를 띄운 채로: 헤드리스 크롬 자동 점검 + 스크린샷
```

## 구조
```
src/
  core/    hex.ts, noise.ts              좌표·노이즈·난수
  world/   terrain.ts, water.ts, sky.ts, overlay.ts
  tiles/   kinds.ts, models.ts, land.ts, sea.ts, index.ts   타일 정의·장식 생성
  items/   kinds.ts, models.ts, index.ts 생물·장식 아이템
  render/  camera.ts, postfx.ts          카메라(잠수)·수중 후처리
  ui/      inventory.ts, hud.ts, placement.ts, quiz.ts
  game/    state.ts                      섬 상태·갱신
  main.ts
```
