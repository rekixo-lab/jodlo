# Worker My Services — private loaded-list local filtering (2026-11-06)

## Real on-device management journey

An opted-in Worker opens My Services, explicitly loads owner-only listing pages from the existing authenticated API, and can now search current loaded Service IDs, Category IDs and **only explicitly fetched approved** bilingual Category labels. Four non-authoritative local presentation filters are available: all loaded, owner-read eligible/visible, owner-published-but-not-visible, and owner-paused. Only server-returned rows are used; no synthetic workers, service claims, phone or location.

The list holds 25/continuation pages under the existing pagination. Displayed counts are explicitly labeled **loaded**, and a continuation warning appears when more owner rows remain. Choosing a filter never removes a row, changes the active selected Service management panel, issues a network request, changes moderation, or claims a public Customer GET. Even an owner-read `visible=true` is not proof that the service is still public: Worker may still explicitly run the pre-existing Customer view check.

Search/filter selection lives only in volatile Compose state, is cleared on sign-out, and is not transmitted to server, backed up or stored. Native Hindi/English UI uses existing flat outlined controls and 64-code-point bounded input. Tests exercise publication combinations, previously ambiguous null status, exact search, Hindi approved names, long labels, no-match, invalid input, and no source modification.

## Still blocked

Full public Worker profiles, area, true calling/Agora+FCM, moderation, production provider proof and last physical acceptance remain separately gated in issue #235. This change adds no API endpoint, migration, user data, provider credential or deployment. Do not infer total service count from currently paginated loaded rows.