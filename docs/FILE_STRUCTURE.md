# Project File Structure - AI Travel Agent with Anam

This reflects the current repository layout.

```
anam-travel-agent/
  backend/
    server.js
    package.json
    package-lock.json
    .env
    .env.example
    test/
      server.test.js
  frontend/
    index.html
    package.json
    package-lock.json
    vite.config.ts
    .env
    public/
      images/
        medina-tunis.jpg
        carthage-ruins.jpg
        bardo-museum.jpg
        sidi-bou-said.jpg
    src/
      App.tsx
      main.tsx
      styles/
        styles.css
      components/
        TravelAgentDemo.tsx
        UIOrchestrator.ts
        DebugHUD.tsx
        DebugHUD.css
        __tests__/
          UIOrchestrator.test.ts
      data/
        landmarks_db.json
        landmarks.ts
        __tests__/
          landmarks.test.ts
      test/
        setup.ts
  docs/
    README.md
    QUICKSTART.md
    PROJECT_PLAN.md
    PROJECT_PLAN_V2.md
    EXECUTIVE_SUMMARY.md
    FILE_STRUCTURE.md
    ASSETS.md
    instructions.txt
  README.md
  LICENSE
```

Key files:
- `frontend/src/components/TravelAgentDemo.tsx` - main demo component
- `frontend/src/components/UIOrchestrator.ts` - tool-driven map orchestration
- `frontend/src/data/landmarks_db.json` - Tunis landmark data
- `backend/server.js` - session token server
