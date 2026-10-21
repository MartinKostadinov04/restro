# Checking a guest's location from the browser, indoors
Made by: research subagent (Sonnet), 10-19, for ticket #38 "Guarding against fake orders on the bill" of map #29.

Labels: [DOC] official documentation, [STUDY] measured study, [ARTICLE] article or vendor page, [READING] my inference, [NOT FOUND] nothing public says it. Numbers in brackets point to the Sources list. Law points are plain rules only, not legal advice.

## Summary

- The phone's browser returns a position plus a "circle of doubt" (`accuracy`, metres, 95% confidence) [DOC 1, 3]. Nothing guarantees it is the real location; the standard itself says so [DOC 3].
- Indoors the position usually comes from Wi-Fi and cell data, not GPS. Wi-Fi positioning is described as 5-50 m in cities, cell positioning as hundreds of metres to kilometres [ARTICLE 16, 26; STUDY 15]. No public measurement exists for a basement club [NOT FOUND].
- Apple's "Precise Location off" and Android's "approximate" give a position good only to a few kilometres (Android: about 3 km2). Such guests cannot be checked against a venue circle [DOC 4, 6].
- Permission is asked per site, can be refused, and on iPhone can be asked again on later visits. Refused or blocked means no position at all, and a site cannot force a second prompt [DOC 3; ARTICLE 11, 14].
- The check can be faked easily by anyone who knows how (browser developer tools, Android mock-location apps, iPhone location changers) and the server cannot see through it [DOC 3, 18; ARTICLE 19, 20]. It stops the casual prankster at home, not a determined one.
- A radius small enough to mean "inside this room" is below what indoor positioning delivers. Android's own guidance sets 100 m as the minimum useful circle [DOC 5]. In a dense city centre, 100 m also covers the street and neighbouring venues.
- Law: a position tied to a phone is personal data and reading it in the browser is processing, even if not stored [DOC 23]. Whether ePrivacy consent rules apply on top is a lawyer's question; the EDPB text points both ways [DOC 21].
- No public data on how often real guests in club basements would be wrongly refused [NOT FOUND]. The causes are known (sections 1-3, 7).

## 1. Accuracy indoors

**What the phone uses.** The standard lists GPS, IP address, Wi-Fi and Bluetooth addresses and cell IDs, and does not say which a browser must use [DOC 3]. Chrome and Firefox ask Google's location service, Safari asks Apple's [ARTICLE 16]. Apple describes a three-step order: GPS, then crowd-sourced Wi-Fi, then cell towers (2011 statement, may have changed) [ARTICLE, not listed below]. On Android, Samsung's help says indoor location relies on Google's network provider and can be wrong when Wi-Fi or cell data on Google's servers is out of date [ARTICLE 27].

**Typical values** (all from vendor or secondary sources unless stated):
- GPS, open sky: about 3 m, 95% of the time [ARTICLE 16]; 5-8.5 m measured on GPS phones outdoors, "larger" indoors [STUDY, search result on Sensors and Materials paper, not opened].
- Wi-Fi: 5-15 m [ARTICLE 16]; 20-50 m in dense urban or commercial spaces [ARTICLE 26 and vendor blog]. Zandbergen's measured 2009 test of the 3G iPhone found a median of about 74 m for Wi-Fi and about 600 m for cell, with A-GPS about 8 m outdoors [STUDY 15]. These are old phones; a modern figure is [NOT FOUND].
- Cell towers only: about a 3/4 square mile area [ARTICLE 16].
- Underground with GPS blocked: a lab test with no signals showed the phone could not get a fix and kept its last known position [STUDY 17]. [READING] In a basement the browser will fall back to Wi-Fi/cell, or return an old position.

**Timing.** `enableHighAccuracy` defaults to false (faster, less precise); `timeout` defaults to infinite; `maximumAge` to 0 (fresh fix required) [DOC 2]. The standard does not promise a time. [NOT FOUND] for measured fix times indoors. Apple warns that approximate positions can be up to 20 minutes old [ARTICLE 7].

**Basement club in central Sofia.** [READING] Likely a position with tens to hundreds of metres of doubt, the best case if the club's own and neighbours' Wi-Fi are in the phone maker's database; worse if GPS-free and database data is stale. 20 m is unlikely to be reliable; 100 m or more is likely. This is inference, not measurement.

## 2. iOS "Precise Location" off

- Apple's developer material (WWDC 2020) says reduced-accuracy positions are cells "roughly a few kilometers" in size (smaller in dense cities), recomputed about four times an hour, and the app can see it is reduced [ARTICLE 6]. A secondary summary quotes `horizontalAccuracy` "about 5 km" and positions up to 20 minutes old [ARTICLE 7]. I found no Apple page stating a radius [NOT FOUND].
- Safari websites have their own Precise Location toggle in Settings > Privacy > Location Services > Safari Websites [ARTICLE, TapSmart/9to5Mac via search].
- How common: [NOT FOUND]. [READING] Default for most apps is precise; the toggle is a one-tap choice in the system prompt for apps, so some guests will have it off.
- Android has the same: approximate gives about 3 km2, precise usually about 50 m or better [DOC 4]. Chrome for Android added a "Precise / Approximate (Neighborhood)" choice in the site prompt in May 2026, and Google plans web APIs so a site can say it needs precise [ARTICLE 13]. Status of those APIs: unknown to me.

## 3. Permission experience

- **Prompt.** Safari on iOS shows a generic "[site] would like to use your current location" with Don't Allow / Allow [ARTICLE, DEV Community]. Chrome on Android shows allow while visiting, allow this time, never allow, plus the new precise/approximate choice [ARTICLE 13].
- **How often.** The W3C standard lets each browser decide, recommends a single browsing session by default [DOC 3]. iOS Safari's website setting defaults to Ask, so it can ask on each visit; setting the site to Allow stops it [ARTICLE 11]. Developers report Safari asks again every time a web app is launched [ARTICLE, DEV Community]. Exact interval: Apple does not document it [NOT FOUND].
- **Two levels on iPhone.** (1) Settings > Privacy > Location Services (all off, or Safari Websites set to Never / Ask Next Time / While Using) and (2) Safari's per-site Ask/Allow/Deny. Never or Location Services off overrides the site setting [ARTICLE 11, DOC 12].
- **What the page gets.** Denied by the user or blocked by the system: error 1 (PERMISSION_DENIED). Phone cannot work out a position: error 2. No answer in time: error 3 [DOC 2]. Non-HTTPS pages get error 1 immediately; HTTPS is required [DOC 2, 3].
- **Re-prompt after refusal.** Once denied, the request fails at once and the page cannot ask again; the user must change the setting [DOC 3]. Chrome blocks a prompt automatically after repeated dismissals (about 3, for about a week, per third-party notes) [ARTICLE 14]. A newer HTML `<geolocation>` button that lets users re-grant exists, support unverified [ARTICLE, whatpwacando].
- **Permissions API.** Supported on iOS Safari 16+ [DOC 10], but unreliable: a Deny can still read as "prompt", and a plain Allow can read "prompt" [ARTICLE 8]. WebKit says it fixed part of this in 2025 [DOC 9]. Practical consequence [READING]: do not trust it; call `getCurrentPosition` and read the error.
- **In-app browsers** (Instagram etc.). [NOT FOUND] for Instagram specifically. Embedded iOS web views have a history of showing no prompt or failing to get location [ARTICLE 28].

## 4. Spoofing

- Chrome DevTools can set any latitude/longitude on any page [DOC 18]. The standard has a built-in emulation feature for testing [DOC 3]. On Android, any app picked as "mock location app" in Developer Options replaces the phone's position [ARTICLE 20]. iPhone: location changers connected to a PC exist and are marketed as working without jailbreak [ARTICLE, search result].
- Can a server tell? The browser hands the server only numbers; nothing in the standard lets the server verify them [DOC 3]. Servers can compare with the IP address's rough location, which sometimes conflicts, but that is a hint, not proof [READING]. Regulated gambling uses a native app that checks for mock-location apps, VPNs, and emulators, per a vendor [ARTICLE 19]; a plain web page cannot do that.
- **What it stops:** a prankster at home with a photo of the QR (the phone says home). **What it doesn't:** someone who spoofs, someone standing within the radius outside the club, a guest inside the venue ordering for a friend elsewhere (the friend is not the one checked).

## 5. Setting the venue point and radius

- No standard exists for web on-site checks. Vendor guides describe one-time `getCurrentPosition`, a distance formula against the venue point, and compare either point-in-circle or whether the accuracy circle overlaps the venue circle [ARTICLE 26]. A threshold above which a result is rejected is a tuning choice; sources give no standard number [NOT FOUND].
- Radius: Android's guide recommends at least 100 m for geofences, to allow for typical Wi-Fi accuracy [DOC 5]. Braze advises 100-150 m [ARTICLE]. A benchmark table gives 10-30 m for urban GPS plus Wi-Fi [ARTICLE 26]. [READING] A radius below the indoor error produces false refusals.
- Comparing the guest's accuracy circle with the venue circle is the described method [ARTICLE 26] but not a documented standard.

## 6. Law (plain rules)

**Clear:**
- "Location data" is named as an identifier in the GDPR's definition of personal data; "processing" is any operation on personal data, which includes collecting and using [DOC 23]. A position that can be tied to a phone or an order is personal data. [READING] Reading it once and discarding still counts as processing, since "any operation" is the test.
- The Article 29 Working Party (predecessor of the EDPB, 2011) treated location of smart devices as personal data and recommended opt-in consent from the user for collecting it [ARTICLE 22]. It was written under the old directive.
- The GDPR says processing "strictly necessary for the purposes of preventing fraud" is a legitimate interest [DOC 24].
- ePrivacy Article 5(3) covers "gaining access to information already stored" in a user's device, including non-personal data. The EDPB's 2024 guidelines say system API use (GPS sensor named) that stays inside the device is not "access", but "when this information or any derivation of this information is accessed", Article 5(3) applies. The same guidelines say that where it applies, consent is not automatic: exemptions may apply [DOC 21, paras 44 and 56].
- Bulgaria: ePrivacy is implemented through the Electronic Communications Act and the Electronic Commerce Act; CPDP (КЗЛД) enforces. Sources conflict on opt-in versus opt-out for cookies, and I found no Bulgarian text or guidance on geolocation [ARTICLE 25; NOT FOUND].

**Needs a lawyer:** (a) whether the browser's own permission prompt counts as the user's consent under ePrivacy; (b) whether a yes/no result sent to the server counts as a "derivation" under paragraph 44, and whether the "strictly necessary for a service the user asked for" exemption fits; (c) legitimate interest versus consent as the GDPR basis, including the balancing test; (d) the minimum content of the privacy notice (purpose, that it is used once and not stored, who receives it, the basis, the controller: venue or Restro).

## 7. Why real guests in a club basement could fail

Known causes [READING built on the facts above]: no GPS underground; a thin or stale Wi-Fi/cell database, so a wide circle or an old position; precise location off (iOS) or approximate only (Android, new Chrome prompt); Location Services off or Safari set to Never; guest refused or dismissed the prompt; in-app browser with no prompt; timeout in a slow fix; Wi-Fi off on the phone while only data is on (Android's Wi-Fi scanning can still help [ARTICLE 27]). Crowds hurt radio positioning: a Bluetooth study at a fair saw error rise to 11 m when crowded [STUDY, search result]; a Google patent exists on locating devices in crowded indoor places [ARTICLE, search result]. **How often real guests fail: [NOT FOUND].** Only a field test in the actual club would show it.

## What this means for Restro

Facts and risks, not decisions.
- The check can work as a coarse "not at home" filter. It cannot prove the guest is inside the room, and in a central-city basement the accuracy circle will often be larger than a tight venue radius.
- The result sent from the page can be faked by anyone who knows how; the server has no way to confirm it.
- Some real guests will be refused for reasons they control (permission, precise off) and some they do not (basement, database). The page needs a path for each of the error codes, and iOS Permissions API values cannot be trusted.
- To check on the server, the position or a derived yes/no must leave the phone, which brings the ePrivacy and privacy-notice questions in section 6 to a lawyer.
- Before deciding, a few minutes of real-device measurement in the pilot club (Wi-Fi on and off, iPhone and Android, precise on and off) would replace the largest [NOT FOUND] with numbers.

## Sources

1. MDN, GeolocationCoordinates.accuracy, developer.mozilla.org/en-US/docs/Web/API/GeolocationCoordinates/accuracy [DOC]
2. MDN, Geolocation.getCurrentPosition, developer.mozilla.org/en-US/docs/Web/API/Geolocation/getCurrentPosition [DOC]
3. W3C Geolocation specification, www.w3.org/TR/geolocation/ (read to about 78%) [DOC]
4. Android developers, Location permissions, developer.android.com/training/location/permissions [DOC]
5. Android developers, Create and monitor geofences, developer.android.com/training/location/geofencing [DOC]
6. Notes on WWDC 2020 "What's new in location", mackuba.eu/notes/wwdc20/whats-new-in-location [ARTICLE]
7. "What's new in CoreLocation for iOS 14", levelup.gitconnected.com (summary; not opened in full) [ARTICLE]
8. Apple Developer Forums thread 751189, developer.apple.com/forums/thread/751189 [ARTICLE]
9. WebKit Bugzilla 275950, bugs.webkit.org/show_bug.cgi?id=275950 [DOC]
10. Can I use, Permissions API geolocation, caniuse.com/mdn-api_permissions_permission_geolocation [DOC]
11. Gadget Hacks, stop websites asking for location every time (iOS Safari), ios.gadgethacks.com [ARTICLE]
12. Apple Support, Location Services on iPhone, support.apple.com/en-us/102647 [DOC]
13. 9to5Google, Chrome approximate location, 9to5google.com/2026/05/05/chrome-approximate-location/ [ARTICLE]
14. Chromium permissions source and Cloud Four, "Time to update your permissions UX", cloudfour.com/thinks/time-to-update-your-permissions-ux/ [ARTICLE]
15. Zandbergen, "Accuracy of iPhone locations", Transactions in GIS 2009 (abstract via proceedings.esri.com) [STUDY]
16. Store Locator Widgets, HTML5 Geolocation accuracy, storelocatorwidgets.com [ARTICLE]
17. "Low-Cost GNSS Simulators with Wireless Clock Synchronization for Indoor Positioning", arxiv.org/pdf/2306.00633 [STUDY]
18. Chrome DevTools, Sensors, developer.chrome.com/docs/devtools/sensors [DOC]
19. GeoComply product pages, geocomply.com/products [ARTICLE, vendor]
20. Make Tech Easier, fake Android location, maketecheasier.com/fake-android-location/ [ARTICLE]
21. EDPB Guidelines 2/2023 on Article 5(3) ePrivacy, v2.0, Oct 2024, edpb.europa.eu (paras 44, 56) [DOC]
22. Alston & Bird summary of WP29 Opinion 13/2011 on geolocation services, alstonprivacy.com [ARTICLE]
23. GDPR Article 4, gdpr-info.eu/art-4-gdpr/ [DOC]
24. GDPR Recital 47, gdpr-info.eu/recitals/no-47/ [DOC]
25. CMS Expert Guide, Bulgaria data protection; Mondaq "Cookies" (Bulgaria) [ARTICLE]
26. Radar, "How accurate is geofencing", radar.com/blog/how-accurate-is-geofencing, and NextBillion geofencing guide [ARTICLE]
27. Samsung support, GPS not working properly on Android, samsung.com/uk/support [ARTICLE]
28. Apple Developer Forums 728248, WKWebView location on iOS 16.4, developer.apple.com/forums/thread/728248 [ARTICLE]
