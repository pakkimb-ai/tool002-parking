(() => {
  const INFO_URL =
    "https://api.data.gov.hk/v1/carpark-info-vacancy?data=info&lang=zh_TW";
  const VAC_URL =
    "https://api.data.gov.hk/v1/carpark-info-vacancy?data=vacancy&vehicleTypes=privateCar,motorCycle&lang=zh_TW";
  const AUTO_MS = 45000;
  const NEAR_LIMIT = 30;

  const $ = (id) => document.getElementById(id);
  const geoStatus = $("geoStatus");
  const parkRoot = $("parkRoot");
  const lastUpdated = $("lastUpdated");
  const btnLocate = $("btnLocate");
  const btnRefresh = $("btnRefresh");
  const searchInput = $("searchInput");
  const districtSelect = $("districtSelect");

  let parksInfo = [];
  let vacancyMap = new Map();
  let userPos = null; // { lat, lng, accuracy }
  let geoDenied = false;
  let timer = null;
  let map = null;
  let markersLayer = null;
  let userLayer = null;
  const markerById = new Map();

  function setStatus(msg, kind = "info") {
    geoStatus.textContent = msg;
    geoStatus.className = `geo-status ${kind}`;
  }

  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toR = (d) => (d * Math.PI) / 180;
    const p1 = toR(lat1);
    const p2 = toR(lat2);
    const dp = toR(lat2 - lat1);
    const dl = toR(lon2 - lon1);
    const a =
      Math.sin(dp / 2) ** 2 +
      Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function fmtDist(m) {
    if (m == null || Number.isNaN(m)) return "—";
    if (m < 1000) return `${Math.round(m)} m`;
    return `${(m / 1000).toFixed(1)} km`;
  }

  function pickVac(arr) {
    if (!arr) return null;
    const row = Array.isArray(arr) ? arr[0] : arr;
    if (!row) return null;
    return {
      type: row.vacancy_type || "A",
      vacancy: row.vacancy,
      lastupdate: row.lastupdate,
      vacancyEV: row.vacancyEV,
    };
  }

  function vacDisplay(info) {
    if (!info) return { text: "—", cls: "unk", title: "無資料" };
    const { type, vacancy } = info;
    if (vacancy == null || vacancy === -1) {
      return { text: "?", cls: "unk", title: "暫無空位數" };
    }
    if (type === "B") {
      if (vacancy === 0) return { text: "滿", cls: "full", title: "已滿" };
      if (vacancy === 1) return { text: "有", cls: "ok", title: "尚有空位" };
      return { text: String(vacancy), cls: "unk", title: "狀態碼" };
    }
    if (type === "C") {
      const n = Number(vacancy);
      const cls = n <= 0 ? "full" : n < 20 ? "low" : "ok";
      return { text: `${n}%`, cls, title: "空置率" };
    }
    const n = Number(vacancy);
    if (n <= 0) return { text: "0", cls: "full", title: "已滿" };
    if (n <= 5) return { text: String(n), cls: "low", title: "所餘無幾" };
    return { text: String(n), cls: "ok", title: "空位數" };
  }

  function shortName(name) {
    const s = String(name || "").trim();
    if (s.length <= 22) return s;
    return s.slice(0, 20) + "…";
  }

  async function fetchJson(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`API ${res.status}`);
    return res.json();
  }

  async function loadInfo() {
    const data = await fetchJson(INFO_URL);
    parksInfo = Array.isArray(data.results) ? data.results : [];
    const districts = [
      ...new Set(parksInfo.map((p) => p.district).filter(Boolean)),
    ].sort((a, b) => a.localeCompare(b, "zh-Hant"));
    const cur = districtSelect.value;
    districtSelect.innerHTML =
      `<option value="">全部地區</option>` +
      districts.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join("");
    if (cur) districtSelect.value = cur;
  }

  async function loadVacancy() {
    const data = await fetchJson(VAC_URL);
    const list = Array.isArray(data.results) ? data.results : [];
    vacancyMap = new Map(list.map((v) => [String(v.park_Id), v]));
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function ensureMap() {
    if (map || typeof L === "undefined") return;
    map = L.map("map", { zoomControl: true, attributionControl: true });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      maxZoom: 20,
      subdomains: "abcd",
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    }).addTo(map);
    markersLayer = L.layerGroup().addTo(map);
    userLayer = L.layerGroup().addTo(map);
    map.setView([22.3027, 114.1772], 12);
  }

  function vacShort(info) {
    return vacDisplay(info).text;
  }

  function updateUserOnMap() {
    ensureMap();
    if (!map || !userLayer) return;
    userLayer.clearLayers();
    if (!userPos) return;

    const latlng = [userPos.lat, userPos.lng];
    const acc = Math.min(Math.max(userPos.accuracy || 40, 25), 200);

    L.circle(latlng, {
      radius: acc,
      color: "#1a8fd0",
      weight: 1,
      fillColor: "#5ec8ff",
      fillOpacity: 0.18,
      interactive: false,
    }).addTo(userLayer);

    const youIcon = L.divIcon({
      className: "you-marker",
      html: '<div class="you-dot"><span>你</span></div>',
      iconSize: [36, 36],
      iconAnchor: [18, 18],
    });
    L.marker(latlng, { icon: youIcon, zIndexOffset: 1000 })
      .bindPopup("你嘅位置")
      .addTo(userLayer);
  }

  function updateMap(rows) {
    ensureMap();
    if (!map) return;
    markersLayer.clearLayers();
    markerById.clear();
    updateUserOnMap();

    const bounds = [];
    if (userPos) bounds.push([userPos.lat, userPos.lng]);

    rows.forEach((p) => {
      if (!Number.isFinite(p._lat) || !Number.isFinite(p._lng)) return;
      const pc = vacShort(p._pc);
      const m = L.circleMarker([p._lat, p._lng], {
        radius: 8,
        color: "#2a1f14",
        weight: 2,
        fillColor: "#ffb020",
        fillOpacity: 0.95,
      });
      const dist =
        p._distance != null
          ? `<div class="pop-meta">${fmtDist(p._distance)}</div>`
          : "";
      m.bindPopup(
        `<div class="pop-name">${esc(shortName(p.name))}</div>` +
          `<div class="pop-meta">空位 ${esc(pc)}</div>${dist}`
      );
      m.on("click", () => highlightCard(String(p.park_Id)));
      m.addTo(markersLayer);
      markerById.set(String(p.park_Id), m);
      bounds.push([p._lat, p._lng]);
    });

    if (bounds.length) {
      try {
        map.fitBounds(bounds, { padding: [36, 36], maxZoom: 16 });
      } catch (_) {}
    } else if (userPos) {
      map.setView([userPos.lat, userPos.lng], 15);
    }
    setTimeout(() => map.invalidateSize(), 80);
  }

  function highlightCard(id) {
    document.querySelectorAll(".park-card.active").forEach((el) =>
      el.classList.remove("active")
    );
    const card = document.querySelector(
      `.park-card[data-id="${CSS.escape(id)}"]`
    );
    if (card) {
      card.classList.add("active");
      card.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  function focusPark(id) {
    highlightCard(id);
    const m = markerById.get(String(id));
    if (m && map) {
      map.setView(m.getLatLng(), Math.max(map.getZoom(), 15), { animate: true });
      m.openPopup();
    }
  }

  function filteredSorted() {
    const q = searchInput.value.trim().toLowerCase();
    const dist = districtSelect.value;
    let rows = parksInfo.map((p) => {
      const lat = Number(p.latitude);
      const lng = Number(p.longitude);
      const vac = vacancyMap.get(String(p.park_Id)) || {};
      let distance = null;
      if (userPos && Number.isFinite(lat) && Number.isFinite(lng)) {
        distance = haversine(userPos.lat, userPos.lng, lat, lng);
      }
      return {
        ...p,
        _lat: lat,
        _lng: lng,
        _distance: distance,
        _pc: pickVac(vac.privateCar),
        _mc: pickVac(vac.motorCycle),
      };
    });

    if (dist) rows = rows.filter((p) => p.district === dist);
    if (q) {
      rows = rows.filter((p) => {
        const blob = `${p.name || ""} ${p.displayAddress || ""} ${
          p.district || ""
        }`.toLowerCase();
        return blob.includes(q);
      });
    }

    if (userPos) {
      rows.sort(
        (a, b) =>
          (a._distance ?? Infinity) - (b._distance ?? Infinity) ||
          String(a.name).localeCompare(String(b.name), "zh-Hant")
      );
      if (!q && !dist) rows = rows.slice(0, NEAR_LIMIT);
    } else {
      rows.sort((a, b) =>
        String(a.name).localeCompare(String(b.name), "zh-Hant")
      );
      if (!q && !dist) rows = rows.slice(0, 40);
    }
    return rows;
  }

  function render() {
    const rows = filteredSorted();
    updateMap(rows);

    if (!rows.length) {
      parkRoot.innerHTML =
        `<p class="empty">搵唔到車場。試下改搜尋字或揀其他地區。</p>`;
      return;
    }
    parkRoot.innerHTML = rows
      .map((p) => {
        const pc = vacDisplay(p._pc);
        const mc = p._mc ? vacDisplay(p._mc) : null;
        const closed =
          String(p.opening_status || "").toUpperCase() === "CLOSED";
        const distChip =
          p._distance != null
            ? `<span class="chip dist">${esc(fmtDist(p._distance))}</span>`
            : "";
        const statusChip = closed
          ? `<span class="chip closed">休息</span>`
          : "";
        return `
<article class="park-card${closed ? " closed" : ""}" data-id="${esc(p.park_Id)}" tabindex="0" title="${esc(p.name)}">
  <div class="vac-stack">
    <div class="vac-badge ${pc.cls}" title="${esc(pc.title)}">
      ${esc(pc.text)}
      <span class="lbl">車</span>
    </div>
    ${
      mc
        ? `<div class="vac-badge mc ${mc.cls}" title="${esc(mc.title)}">
      ${esc(mc.text)}
      <span class="lbl">電單</span>
    </div>`
        : ""
    }
  </div>
  <div class="park-body">
    <h2>${esc(shortName(p.name))}</h2>
    <div class="meta-row">
      ${distChip}
      ${statusChip}
      ${p.district ? `<span class="chip">${esc(p.district)}</span>` : ""}
    </div>
  </div>
</article>`;
      })
      .join("");
    parkRoot.querySelectorAll(".park-card").forEach((card) => {
      card.addEventListener("click", () => focusPark(card.dataset.id));
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          focusPark(card.dataset.id);
        }
      });
    });
  }

  function stamp() {
    const now = new Date();
    const hk = now.toLocaleString("zh-HK", {
      timeZone: "Asia/Hong_Kong",
      hour12: false,
    });
    lastUpdated.textContent = `上次更新：${hk}（香港時間）`;
  }

  async function refreshVacancyOnly() {
    btnRefresh.disabled = true;
    parkRoot.classList.add("loading");
    try {
      await loadVacancy();
      render();
      stamp();
    } catch (e) {
      setStatus(`刷新空位失敗：${e.message}`, "warn");
    } finally {
      btnRefresh.disabled = false;
      parkRoot.classList.remove("loading");
    }
  }

  function locate() {
    if (!navigator.geolocation) {
      geoDenied = true;
      setStatus(
        "瀏覽器唔支援定位。可用地區篩選或搜尋車場名稱。",
        "warn"
      );
      render();
      return;
    }
    setStatus("定位中…", "info");
    btnLocate.disabled = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        userPos = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy || 40,
        };
        geoDenied = false;
        const acc = Math.round(userPos.accuracy);
        setStatus(
          `已定位（約 ±${acc} m）。地圖藍圈＝你 · 黃點＝車場。`,
          "ok"
        );
        btnLocate.disabled = false;
        render();
      },
      (err) => {
        geoDenied = true;
        userPos = null;
        const reason =
          err.code === 1
            ? "你拒絕咗定位權限"
            : err.code === 2
              ? "暫時拎唔到位置"
              : "定位逾時";
        setStatus(
          `${reason}。可用「地區」篩選或搜尋名稱睇空位。`,
          "warn"
        );
        btnLocate.disabled = false;
        render();
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
    );
  }

  async function boot() {
    ensureMap();
    setStatus("載入車場資料…", "info");
    try {
      await Promise.all([loadInfo(), loadVacancy()]);
      setStatus(
        `已載入 ${parksInfo.length} 個參與車場。正在定位…`,
        "info"
      );
      stamp();
      render();
      locate();
      if (timer) clearInterval(timer);
      timer = setInterval(refreshVacancyOnly, AUTO_MS);
    } catch (e) {
      setStatus(`載入失敗：${e.message}。請檢查網絡後再刷新。`, "warn");
    }
  }

  btnLocate.addEventListener("click", locate);
  btnRefresh.addEventListener("click", refreshVacancyOnly);
  searchInput.addEventListener("input", () => render());
  districtSelect.addEventListener("change", () => render());

  boot();
})();
