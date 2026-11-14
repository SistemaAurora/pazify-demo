/* =========================================================
   Pazify — compra contra entrega en Perú
   Configura tu WhatsApp y el endpoint de pedidos.
   ========================================================= */

(() => {
  "use strict";

  const CONFIG = {
    whatsapp: "51972841004", // +51 972 841 004
    currency: "PEN",
    product: {
      name: "Pazify 3 en 1",
      image: "assets/img/pazify-product-main.webp",
    },
    packs: {
      1: { units: 1, price: 49.9, compareAt: 89.9, perUnit: 49.9, label: "1 unidad", savings: 40 },
      2: { units: 2, price: 89.9, compareAt: 149.9, perUnit: 44.95, label: "2 unidades", savings: 60 },
      3: { units: 3, price: 129.9, compareAt: 199.9, perUnit: 43.3, label: "3 unidades", savings: 70 },
    },
    offerPopDelay: 12000,
    zipagoLinks: {
      1: "",
      2: "",
      3: "",
    },
    orderEndpoint: "https://pazify-orders-live.troubled-walrus.workers.dev/order", // Worker gratuito temporal. Reclámalo en Cloudflare.
    orderEndpointTimeout: 15000,
    analytics: {
      gtmId: "",
      ga4Id: "",
      metaPixelId: "1708740150670609",
    },
  };

  const LOCATIONS = window.PAZIFY_LOCATIONS || {};
  const OFFER_KEY = "pazify_offer_pop_seen";
  const CONSENT_KEY = "pazify_consent_v1";

  const state = {
    selectedPack: 1,
    orderStarted: false,
    submitting: false,
    lastOrderText: "",
    lastOrderCode: "",
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const els = {
    header: $("[data-header]"),
    overlay: $("[data-overlay]"),
    price: $("[data-price]"),
    priceOld: $("[data-price-old]"),
    priceNote: $("[data-price-note]"),
    priceBadge: $("[data-price-badge]"),
    orderPriceCta: $("[data-order-price-cta]"),
    mobilePrice: $("[data-mobile-price]"),
    orderModal: $("#order-modal"),
    orderForm: $("[data-order-form]"),
    orderStatus: $("[data-order-status]"),
    orderSuccess: $("[data-order-success]"),
    orderSuccessTitle: $("[data-order-success-title]"),
    orderSuccessMessage: $("[data-order-success-message]"),
    orderCode: $("[data-order-code]"),
    orderPackLabel: $("[data-order-pack-label]"),
    orderPackPrice: $("[data-order-pack-price]"),
    orderPackCompare: $("[data-order-pack-compare]"),
    orderTotal: $("[data-order-total]"),
    mobileOld: $("[data-mobile-old]"),
    departmentSelect: $("[data-department-select]"),
    citySelect: $("[data-city-select]"),
    cityOtherWrap: $("[data-city-other-wrap]"),
    cityOtherInput: $('input[name="cityOther"]'),
    galleryMain: $("[data-gallery-main]"),
    galleryThumbs: $$("[data-gallery-thumbs] .thumb"),
    galleryDots: $$("[data-gallery-dot]"),
    lightbox: $("#lightbox"),
    lightboxImage: $("[data-lightbox-image]"),
    lightboxCaption: $("[data-lightbox-caption]"),
    toast: $("[data-toast]"),
    mobileBar: $("[data-mobile-buy-bar]"),
    buySection: $(".buybox"),
    offerPop: $("[data-offer-pop]"),
    videoModal: $("#video-modal"),
    consentBanner: $("[data-consent-banner]"),
  };

  let activeDialog = null;
  let lastFocused = null;
  let toastTimer = null;

  /* ---------- Utilidades ---------- */

  const money = (value) => `S/ ${(Number(value) || 0).toFixed(2)}`;

  const eventMap = {
    view_item: "ViewContent",
    select_item: "SelectPack",
    begin_checkout: "InitiateCheckout",
    order_created: "OrderCreated",
    whatsapp_order_started: "WhatsAppOrderStarted",
    whatsapp_click: "WhatsAppClick",
    offer_pop_view: "OfferPopView",
    faq_open: "FAQOpen",
    scroll_depth: "ScrollDepth",
  };

  const META_STANDARD_EVENTS = new Set(["ViewContent", "InitiateCheckout", "Lead", "Contact"]);

  const metaParams = (data = {}) => {
    const params = {};
    if (data.currency) params.currency = data.currency;
    if (Number.isFinite(data.value)) params.value = data.value;
    if (Array.isArray(data.items) && data.items.length) {
      const ids = data.items.map((item) => item.item_id).filter(Boolean);
      if (ids.length) params.content_ids = ids;
      params.content_type = "product";
      if (data.items[0].item_name) params.content_name = data.items[0].item_name;
      params.num_items = data.items.reduce((sum, item) => sum + (Number(item.quantity) || 1), 0);
    } else if (data.item_variant) {
      params.content_name = data.item_variant;
    }
    if (data.transaction_id) params.transaction_id = data.transaction_id;
    if (data.payment_method) params.payment_method = data.payment_method;
    return params;
  };

  const track = (event, data = {}) => {
    const payload = { event, ...data };
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(payload);

    if (CONFIG.analytics.ga4Id && !CONFIG.analytics.gtmId && typeof window.gtag === "function") {
      window.gtag("event", eventMap[event] || event, data);
    }

    if (CONFIG.analytics.metaPixelId && typeof window.fbq === "function") {
      const metaMap = {
        view_item: "ViewContent",
        select_item: "SelectPack",
        begin_checkout: "InitiateCheckout",
        order_created: "Lead",
        whatsapp_click: "Contact",
      };
      const metaEvent = metaMap[event] || event;
      const params = metaParams(data);
      if (META_STANDARD_EVENTS.has(metaEvent)) window.fbq("track", metaEvent, params);
      else window.fbq("trackCustom", metaEvent, params);
    }

    document.dispatchEvent(new CustomEvent("pazify:track", { detail: payload }));
    if (new URLSearchParams(window.location.search).has("debug")) {
      console.debug("[pazify]", event, data);
    }
  };

  const trackViewItem = () => {
    if (window.__pazifyViewItemTracked) return;
    window.__pazifyViewItemTracked = true;
    track("view_item", {
      currency: CONFIG.currency,
      value: CONFIG.packs[1].price,
      items: [{
        item_name: `${CONFIG.product.name} — 1 unidad`,
        item_id: "PAZ-3IN1-1",
        price: CONFIG.packs[1].price,
        quantity: 1,
        item_variant: "1 unidad",
      }],
    });
  };

  const showToast = (message, duration = 3400) => {
    if (!els.toast) return;
    window.clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => els.toast.classList.remove("is-visible"), duration);
  };

  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    }
  };

  const safeSession = {
    get(key) {
      try {
        return window.sessionStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        window.sessionStorage.setItem(key, value);
      } catch {
        /* noop */
      }
    },
  };


  const populateCities = (department) => {
    if (!els.citySelect) return;
    const cities = LOCATIONS[department] || [];
    els.citySelect.innerHTML = [
      '<option value="">Selecciona tu ciudad o distrito</option>',
      ...cities.map((city) => `<option value="${city}">${city}</option>`),
      '<option value="Otro">Otro distrito / ciudad</option>',
    ].join("");
    els.citySelect.disabled = !department;
    els.citySelect.value = "";
    if (els.cityOtherWrap) els.cityOtherWrap.hidden = true;
    if (els.cityOtherInput) {
      els.cityOtherInput.required = false;
      els.cityOtherInput.value = "";
    }
  };

  const syncCityOther = () => {
    if (!els.citySelect) return;
    const isOther = els.citySelect.value === "Otro";
    if (els.cityOtherWrap) els.cityOtherWrap.hidden = !isOther;
    if (els.cityOtherInput) {
      els.cityOtherInput.required = isOther;
      if (isOther) window.setTimeout(() => els.cityOtherInput.focus(), 40);
    }
  };

  /* ---------- Packs ---------- */

  const syncPackUI = () => {
    const pack = CONFIG.packs[state.selectedPack] || CONFIG.packs[1];

    if (els.price) els.price.textContent = money(pack.price);
    if (els.priceOld) els.priceOld.textContent = money(pack.compareAt);
    if (els.priceNote) els.priceNote.textContent = `${pack.label} · ${money(pack.perUnit)} c/u · Ahorras ${money(pack.savings)}`;
    if (els.priceBadge) els.priceBadge.textContent = "🚚 Envío gratis";
    if (els.orderPriceCta) els.orderPriceCta.textContent = money(pack.price);
    if (els.mobilePrice) els.mobilePrice.textContent = money(pack.price);
    if (els.mobileOld) els.mobileOld.textContent = money(pack.compareAt);
    if (els.orderPackLabel) els.orderPackLabel.textContent = pack.label;
    if (els.orderPackPrice) els.orderPackPrice.textContent = money(pack.price);
    if (els.orderPackCompare) els.orderPackCompare.textContent = money(pack.compareAt);
    if (els.orderTotal) els.orderTotal.textContent = money(pack.price);

    $$('[data-bundle-form] input[name="bundle"]').forEach((input) => {
      input.checked = Number(input.value) === state.selectedPack;
    });

    $$("[data-order-pack]").forEach((button) => {
      const active = Number(button.dataset.orderPack) === state.selectedPack;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  };

  const selectPack = (value, options = {}) => {
    const packNumber = Number(value);
    if (!CONFIG.packs[packNumber]) return;
    state.selectedPack = packNumber;
    syncPackUI();

    if (!options.silent) {
      track("select_item", {
        item_list_name: "Pazify packs",
        item_variant: CONFIG.packs[packNumber].label,
        value: CONFIG.packs[packNumber].price,
        currency: CONFIG.currency,
      });
    }
  };

  /* ---------- Diálogos ---------- */

  const focusableSelectors = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "[tabindex]:not([tabindex='-1'])",
  ].join(",");

  const getFocusable = (root) => $$(focusableSelectors, root)
    .filter((element) => element.offsetParent !== null || element.getClientRects().length > 0);

  const openDialog = (dialog) => {
    if (!dialog) return;
    if (activeDialog && activeDialog !== dialog) closeDialog(false);
    lastFocused = document.activeElement;
    activeDialog = dialog;
    if (els.overlay) {
      els.overlay.classList.add("is-open");
      els.overlay.setAttribute("aria-hidden", "false");
    }
    dialog.classList.add("is-open");
    dialog.setAttribute("aria-hidden", "false");
    document.body.classList.add("dialog-open");
    window.setTimeout(() => {
      const focusable = getFocusable(dialog);
      if (focusable.length) focusable[0].focus({ preventScroll: true });
    }, 60);
  };

  const closeDialog = (restoreFocus = true) => {
    if (!activeDialog) return;
    const dialog = activeDialog;
    dialog.classList.remove("is-open");
    dialog.setAttribute("aria-hidden", "true");
    if (els.overlay) {
      els.overlay.classList.remove("is-open");
      els.overlay.setAttribute("aria-hidden", "true");
    }
    document.body.classList.remove("dialog-open");
    activeDialog = null;
    if (restoreFocus && lastFocused && typeof lastFocused.focus === "function") {
      lastFocused.focus({ preventScroll: true });
    }
  };

  /* ---------- Pedido contra entrega ---------- */

  const normalizePeruPhone = (value) => String(value || "").replace(/\D/g, "").replace(/^51/, "");

  const validatePeruPhone = (input) => {
    if (!input) return false;
    const valid = /^9\d{8}$/.test(normalizePeruPhone(input.value));
    input.setCustomValidity(valid ? "" : "Ingresa un celular peruano de 9 dígitos que empiece con 9.");
    return valid;
  };

  const getOrderCode = () => {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `PZ-${date}-${suffix}`;
  };

  const resetOrderModal = () => {
    if (!els.orderModal) return;
    const card = $(".modal-order", els.orderModal);
    if (card) card.classList.remove("is-success");
    els.orderModal.setAttribute("aria-labelledby", "order-title");
    if (els.orderSuccess) els.orderSuccess.hidden = true;
    if (els.orderForm) {
      els.orderForm.hidden = false;
      els.orderForm.reset();
      populateCities("");
    }
    if (els.orderStatus) els.orderStatus.textContent = "";
  };

  const openOrder = () => {
    if (!els.orderModal) return;
    state.orderStarted = true;
    if (els.orderSuccess && !els.orderSuccess.hidden) resetOrderModal();
    else if (els.orderSuccess) els.orderSuccess.hidden = true;
    if (els.orderForm) els.orderForm.hidden = false;
    syncPackUI();
    openDialog(els.orderModal);
    track("begin_checkout", {
      currency: CONFIG.currency,
      value: CONFIG.packs[state.selectedPack].price,
      item_variant: CONFIG.packs[state.selectedPack].label,
    });
  };

  const buildOrderText = (data, orderCode) => {
    const pack = CONFIG.packs[state.selectedPack];
    const lines = [
      "Hola Pazify 👋 Quiero confirmar este pedido:",
      "",
      `Código de pedido: ${orderCode}`,
      `Producto: ${CONFIG.product.name}`,
      `Pack: ${pack.label}`,
      `Cantidad: ${pack.units} unidad(es)`,
      `Precio regular: ${money(pack.compareAt)}`,
      `Precio de lanzamiento: ${money(pack.price)}`,
      `Ahorro: ${money(pack.savings)}`,
      "",
      "Envío: Gratis a todo el Perú (sujeto a cobertura)",
      `Método de pago: ${data.payment === "tarjeta" ? "tarjeta de crédito/débito (Zipago)" : "contra entrega"}`,
      "",
      `Nombre: ${data.name}`,
      `WhatsApp: ${data.phone}`,
      `Departamento: ${data.department}`,
      `Ciudad / distrito: ${data.city}`,
      `Dirección: ${data.address}`,
    ];
    if (data.reference) lines.push(`Referencia: ${data.reference}`);
    return lines.join("\n");
  };

  const redirectToThankYou = ({ code, data, pack, status = "registered", paymentUrl = "" }) => {
    const summary = {
      code,
      name: data.name,
      packLabel: pack.label,
      total: `${CONFIG.currency} ${pack.price.toFixed(2)}`,
      payment: data.payment,
      paymentUrl,
      status,
    };
    try {
      window.sessionStorage.setItem("pazify_last_order", JSON.stringify(summary));
    } catch {
      /* noop */
    }
    const finish = () => {
      window.location.href = `gracias.html?code=${encodeURIComponent(code)}`;
    };
    // Deja que el pixel alcance a enviar Lead antes de navegar.
    if (typeof window.fbq === "function") window.setTimeout(finish, 350);
    else finish();
  };

  const handleOrderSubmit = async (event) => {
    event.preventDefault();
    if (!els.orderForm || state.submitting) return;

    const phoneInput = els.orderForm.querySelector('input[name="phone"]');
    if (!validatePeruPhone(phoneInput)) {
      phoneInput.reportValidity();
      if (els.orderStatus) els.orderStatus.textContent = "Revisa el número de WhatsApp: debe ser un celular peruano de 9 dígitos.";
      return;
    }

    if (!els.orderForm.checkValidity()) {
      els.orderForm.reportValidity();
      if (els.orderStatus) els.orderStatus.textContent = "Completa los datos marcados para confirmar tu pedido.";
      return;
    }

    const formData = new FormData(els.orderForm);
    const data = {
      name: String(formData.get("name") || "").trim(),
      phone: normalizePeruPhone(formData.get("phone")),
      department: String(formData.get("department") || "").trim(),
      city: String(formData.get("city") || "").trim() === "Otro"
        ? String(formData.get("cityOther") || "").trim()
        : String(formData.get("city") || "").trim(),
      address: String(formData.get("address") || "").trim(),
      reference: String(formData.get("reference") || "").trim(),
      payment: String(formData.get("payment") || "contraentrega"),
    };

    const pack = CONFIG.packs[state.selectedPack];
    const localCode = getOrderCode();
    const submitButton = els.orderForm.querySelector('button[type="submit"]');

    state.lastOrderCode = localCode;
    state.lastOrderText = buildOrderText(data, localCode);

    if (!CONFIG.orderEndpoint && CONFIG.whatsapp) {
      redirectToThankYou({ code: localCode, data, pack, status: "whatsapp" });
      track("whatsapp_order_started", {
        transaction_id: localCode,
        currency: CONFIG.currency,
        value: pack.price,
        pack: pack.label,
      });
      return;
    }

    state.submitting = true;
    if (submitButton) submitButton.disabled = true;
    if (els.orderStatus) els.orderStatus.textContent = "Registrando tu pedido…";

    let timeoutId;
    try {
      const controller = new AbortController();
      timeoutId = window.setTimeout(() => controller.abort(), CONFIG.orderEndpointTimeout);
      const response = await fetch(CONFIG.orderEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderCode: localCode,
          name: data.name,
          phone: data.phone,
          department: data.department,
          city: data.city,
          address: data.address,
          reference: data.reference,
          payment: data.payment,
          pack: state.selectedPack,
          packLabel: pack.label,
          quantity: pack.units,
          price: pack.price,
          compareAt: pack.compareAt,
          savings: pack.savings,
          currency: CONFIG.currency,
          consent: true,
          source: "web",
          pageUrl: window.location.href,
          createdAt: new Date().toISOString(),
        }),
        signal: controller.signal,
      });
      window.clearTimeout(timeoutId);

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json().catch(() => ({}));
      if (result.ok === false) throw new Error(result.error || "Pedido rechazado");

      const serverCode = result.orderId || result.id || localCode;
      state.lastOrderCode = serverCode;
      state.lastOrderText = buildOrderText(data, serverCode);

      const paymentUrl = data.payment === "tarjeta"
        ? (CONFIG.zipagoLinks?.[state.selectedPack] || "")
        : "";

      track("order_created", {
        transaction_id: serverCode,
        currency: CONFIG.currency,
        value: pack.price,
        shipping: 0,
        status: "created",
        payment_method: data.payment,
        items: [{ item_name: `${CONFIG.product.name} — ${pack.label}`, price: pack.price, quantity: 1 }],
      });

      redirectToThankYou({ code: serverCode, data, pack, status: "registered", paymentUrl });
    } catch (error) {
      if (els.orderStatus) {
        els.orderStatus.textContent = "No pudimos registrar tu pedido. No se ha confirmado nada. Intenta de nuevo o escríbenos por WhatsApp.";
      }
      showToast("No se registró el pedido. Intenta de nuevo.");
    } finally {
      window.clearTimeout(timeoutId);
      state.submitting = false;
      if (submitButton) submitButton.disabled = false;
    }
  };

  /* ---------- Galería ---------- */

  const setGalleryImage = (thumb, trackEvent = true) => {
    if (!thumb || !els.galleryMain) return;
    const src = thumb.dataset.src;
    const alt = thumb.dataset.alt || "";
    if (!src) return;
    els.galleryMain.removeAttribute("srcset");
    els.galleryMain.removeAttribute("sizes");
    els.galleryMain.src = src;
    els.galleryMain.alt = alt;
    els.galleryThumbs.forEach((item) => {
      const active = item === thumb;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-selected", String(active));
    });
    const activeIndex = els.galleryThumbs.indexOf(thumb);
    els.galleryDots.forEach((dot, dotIndex) => {
      const active = dotIndex === activeIndex;
      dot.classList.toggle("is-active", active);
      dot.setAttribute("aria-pressed", String(active));
    });
    if (trackEvent) track("gallery_view", { image: src });
  };

  const openLightbox = () => {
    if (!els.galleryMain || !els.lightboxImage) return;
    els.lightboxImage.src = els.galleryMain.currentSrc || els.galleryMain.src;
    els.lightboxImage.alt = els.galleryMain.alt;
    if (els.lightboxCaption) els.lightboxCaption.textContent = els.galleryMain.alt;
    openDialog(els.lightbox);
  };

  /* ---------- Tabs ---------- */

  const activateTab = (name) => {
    const tabs = $$("[data-tab]");
    const panels = $$("[data-panel]");
    tabs.forEach((tab) => {
      const active = tab.dataset.tab === name;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    panels.forEach((panel) => {
      const active = panel.dataset.panel === name;
      panel.classList.toggle("is-active", active);
      panel.hidden = !active;
    });
    track("feature_tab_view", { feature: name });
  };

  /* ---------- Popup de oferta ---------- */

  const openOfferPop = () => {
    if (!els.offerPop) return;
    if (window.matchMedia("(max-width: 767px)").matches) return;
    if (state.orderStarted || activeDialog || document.body.classList.contains("dialog-open")) return;
    if (safeSession.get(OFFER_KEY) === "1") return;
    els.offerPop.classList.add("is-open");
    els.offerPop.setAttribute("aria-hidden", "false");
    safeSession.set(OFFER_KEY, "1");
    track("offer_pop_view");
  };

  const closeOfferPop = () => {
    if (!els.offerPop) return;
    els.offerPop.classList.remove("is-open");
    els.offerPop.setAttribute("aria-hidden", "true");
    safeSession.set(OFFER_KEY, "1");
  };

  const setupOfferPop = () => {
    window.setTimeout(openOfferPop, CONFIG.offerPopDelay);
    document.addEventListener("mouseout", (event) => {
      if (!event.relatedTarget && event.clientY <= 0) openOfferPop();
    });
  };

  /* ---------- WhatsApp y enlaces externos ---------- */

  const setupExternalLinks = () => {
    $$("[data-whatsapp-link]").forEach((link) => {
      link.addEventListener("click", (event) => {
        if (!CONFIG.whatsapp) {
          event.preventDefault();
          showToast("WhatsApp no está disponible en este momento. Intenta más tarde.");
          return;
        }
        link.href = `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent("Hola Pazify, tengo una duda sobre la botella 3 en 1.")}`;
        track("whatsapp_click", { location: link.className || "link" });
      });
    });

    $$("[data-coming-soon]").forEach((link) => {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        showToast("Muy pronto tendremos novedades en nuestras redes.");
      });
    });
  };


  const loadAnalytics = () => {
    const { gtmId, ga4Id, metaPixelId } = CONFIG.analytics;
    if (!gtmId && !ga4Id && !metaPixelId) return;

    if (gtmId && !window.__pazifyGtmLoaded) {
      window.__pazifyGtmLoaded = true;
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({ "gtm.start": new Date().getTime(), event: "gtm.js" });
      const script = document.createElement("script");
      script.async = true;
      script.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(gtmId)}`;
      document.head.appendChild(script);
    }

    if (ga4Id && !gtmId && !window.__pazifyGa4Loaded) {
      window.__pazifyGa4Loaded = true;
      const script = document.createElement("script");
      script.async = true;
      script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga4Id)}`;
      document.head.appendChild(script);
      window.dataLayer = window.dataLayer || [];
      window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
      window.gtag("js", new Date());
      window.gtag("config", ga4Id);
    }

    if (metaPixelId && !window.__pazifyMetaLoaded) {
      window.__pazifyMetaLoaded = true;
      /* eslint-disable */
      !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
      n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
      n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
      t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script',
      'https://connect.facebook.net/en_US/fbevents.js');
      /* eslint-enable */
      window.fbq("init", metaPixelId);
      window.fbq("track", "PageView");
    }

    trackViewItem();
  };

  const setupConsent = () => {
    const hasAnalytics = Object.values(CONFIG.analytics).some(Boolean);
    if (!hasAnalytics || !els.consentBanner) return;

    let stored = null;
    try {
      stored = window.localStorage.getItem(CONSENT_KEY);
    } catch {
      stored = null;
    }

    if (stored === "accepted") {
      loadAnalytics();
      return;
    }
    if (stored === "rejected") return;

    els.consentBanner.hidden = false;
    $$("[data-consent]").forEach((button) => {
      button.addEventListener("click", () => {
        const choice = button.dataset.consent;
        try {
          window.localStorage.setItem(CONSENT_KEY, choice);
        } catch {
          /* noop */
        }
        els.consentBanner.hidden = true;
        if (choice === "accept") loadAnalytics();
      });
    });
  };

  const setupVideo = () => {
    $$("[data-video-open]").forEach((button) => {
      button.addEventListener("click", () => openDialog(els.videoModal));
    });
  };

  /* ---------- Scroll y animaciones ---------- */

  const setupReveal = () => {
    const candidates = [
      ...$$(".pdp-grid > *"),
      ...$$(".trust-strip-grid > div"),
      ...$$(".section-heading"),
      ...$$(".how-tabs, .how-panels"),
      ...$$(".bento-card"),
      ...$$(".comparison-table"),
      ...$$(".reviews-grid > *"),
      ...$$(".faq-grid > *"),
      ...$$(".cod-inner > *"),
      ...$$(".final-grid > *"),
      ...$$(".footer-grid > *"),
    ];

    candidates.forEach((element) => element.classList.add("reveal"));

    if (!("IntersectionObserver" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      candidates.forEach((element) => element.classList.add("is-visible"));
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });

    candidates.forEach((element) => observer.observe(element));
  };

  const setupScrollDepth = () => {
    const thresholds = [25, 50, 75, 90];
    const reached = new Set();
    let ticking = false;

    const measure = () => {
      ticking = false;
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      if (scrollable <= 0) return;
      const percent = Math.round((window.scrollY / scrollable) * 100);
      thresholds.forEach((threshold) => {
        if (percent >= threshold && !reached.has(threshold)) {
          reached.add(threshold);
          track("scroll_depth", { percent: threshold });
        }
      });
    };

    window.addEventListener("scroll", () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(measure);
    }, { passive: true });
  };

  const setupHeader = () => {
    if (!els.header) return;
    const update = () => els.header.classList.toggle("is-scrolled", window.scrollY > 8);
    update();
    window.addEventListener("scroll", update, { passive: true });
  };


  const setupGalleryAutoplay = () => {
    if (!els.galleryMain || !els.galleryThumbs.length) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let index = Math.max(0, els.galleryThumbs.findIndex((thumb) => thumb.classList.contains("is-active")));
    let paused = false;
    let resumeTimer;

    const pause = (duration = 0) => {
      paused = true;
      window.clearTimeout(resumeTimer);
      if (duration) {
        resumeTimer = window.setTimeout(() => { paused = false; }, duration);
      }
    };

    const resume = () => {
      window.clearTimeout(resumeTimer);
      paused = false;
    };

    els.galleryThumbs.forEach((thumb, thumbIndex) => {
      thumb.addEventListener("click", () => {
        index = thumbIndex;
        pause(12000);
      });
      thumb.addEventListener("focus", () => pause());
      thumb.addEventListener("blur", () => resume());
    });

    els.galleryDots.forEach((dot, dotIndex) => {
      dot.addEventListener("click", () => {
        index = dotIndex;
        setGalleryImage(els.galleryThumbs[dotIndex], true);
        pause(12000);
      });
    });

    els.galleryMain.addEventListener("mouseenter", () => pause());
    els.galleryMain.addEventListener("mouseleave", () => resume());
    els.galleryMain.addEventListener("focusin", () => pause());
    els.galleryMain.addEventListener("focusout", () => resume());

    window.setInterval(() => {
      if (paused || activeDialog || document.hidden) return;
      index = (index + 1) % els.galleryThumbs.length;
      setGalleryImage(els.galleryThumbs[index], false);
    }, 5500);
  };

  /* ---------- Eventos ---------- */

  const bindEvents = () => {
    $$("[data-open-order]").forEach((button) => {
      button.addEventListener("click", openOrder);
    });

    $$("[data-bundle-form] input[name='bundle']").forEach((input) => {
      input.addEventListener("change", () => selectPack(input.value));
    });

    $$("[data-order-pack]").forEach((button) => {
      button.addEventListener("click", () => selectPack(button.dataset.orderPack));
    });

    $$("[data-close-modal]").forEach((button) => {
      button.addEventListener("click", () => closeDialog());
    });

    $$("[data-close-offer]").forEach((button) => {
      button.addEventListener("click", closeOfferPop);
    });

    if (els.overlay) {
      els.overlay.addEventListener("click", () => closeDialog());
    }

    if (els.orderForm) els.orderForm.addEventListener("submit", handleOrderSubmit);

    $$("[data-copy-order]").forEach((button) => {
      button.addEventListener("click", async () => {
        const text = state.lastOrderText || `Pedido ${state.lastOrderCode}`;
        const ok = await copyText(text);
        showToast(ok ? "Pedido copiado al portapapeles." : "No pudimos copiar el pedido.");
      });
    });

    $$("[data-gallery-thumbs] .thumb").forEach((thumb) => {
      thumb.addEventListener("click", () => setGalleryImage(thumb));
      thumb.addEventListener("keydown", (event) => {
        const index = els.galleryThumbs.indexOf(thumb);
        if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
          event.preventDefault();
          const nextIndex = event.key === "ArrowRight"
            ? (index + 1) % els.galleryThumbs.length
            : (index - 1 + els.galleryThumbs.length) % els.galleryThumbs.length;
          els.galleryThumbs[nextIndex].focus();
          setGalleryImage(els.galleryThumbs[nextIndex]);
        }
      });
    });

    $$("[data-lightbox-open]").forEach((button) => {
      button.addEventListener("click", openLightbox);
    });

    const phoneInput = els.orderForm?.querySelector('input[name="phone"]');
    if (phoneInput) {
      phoneInput.addEventListener("input", () => phoneInput.setCustomValidity(""));
      phoneInput.addEventListener("blur", () => validatePeruPhone(phoneInput));
    }

    if (els.departmentSelect) {
      els.departmentSelect.addEventListener("change", () => populateCities(els.departmentSelect.value));
    }
    if (els.citySelect) {
      els.citySelect.addEventListener("change", syncCityOther);
    }

    const tabs = $$("[data-tab]");
    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => activateTab(tab.dataset.tab));
      tab.addEventListener("keydown", (event) => {
        if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        let nextIndex = index;
        if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
        if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
        if (event.key === "Home") nextIndex = 0;
        if (event.key === "End") nextIndex = tabs.length - 1;
        tabs[nextIndex].focus();
        activateTab(tabs[nextIndex].dataset.tab);
      });
    });

    $$(".faq-item").forEach((item) => {
      item.addEventListener("toggle", () => {
        if (!item.open) return;
        $$(".faq-item").forEach((other) => {
          if (other !== item) other.open = false;
        });
        track("faq_open", { question: item.querySelector("summary")?.textContent?.trim() || "" });
      });
    });

    const menuToggle = $("[data-menu-toggle]");
    if (menuToggle) {
      menuToggle.addEventListener("click", () => {
        const open = !document.body.classList.contains("nav-open");
        document.body.classList.toggle("nav-open", open);
        menuToggle.setAttribute("aria-expanded", String(open));
        const label = menuToggle.querySelector(".sr-only");
        if (label) label.textContent = open ? "Cerrar menú" : "Abrir menú";
      });
      $$("#primary-nav a").forEach((link) => {
        link.addEventListener("click", () => {
          document.body.classList.remove("nav-open");
          menuToggle.setAttribute("aria-expanded", "false");
          const label = menuToggle.querySelector(".sr-only");
          if (label) label.textContent = "Abrir menú";
        });
      });
      window.addEventListener("resize", () => {
        if (window.innerWidth > 860) {
          document.body.classList.remove("nav-open");
          menuToggle.setAttribute("aria-expanded", "false");
        }
      });
    }

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        if (els.offerPop?.classList.contains("is-open")) {
          closeOfferPop();
          return;
        }
        if (document.body.classList.contains("nav-open")) {
          document.body.classList.remove("nav-open");
          const menu = $("[data-menu-toggle]");
          if (menu) {
            menu.setAttribute("aria-expanded", "false");
            const label = menu.querySelector(".sr-only");
            if (label) label.textContent = "Abrir menú";
          }
          return;
        }
        if (activeDialog) closeDialog();
      }

      if (event.key !== "Tab" || !activeDialog) return;
      const focusable = getFocusable(activeDialog);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  };

  /* ---------- Init ---------- */

  const init = () => {
    syncPackUI();
    populateCities(els.departmentSelect?.value || "");
    setupExternalLinks();
    bindEvents();
    setupVideo();
    setupGalleryAutoplay();
    setupConsent();
    setupReveal();
    setupScrollDepth();
    setupHeader();
    setupOfferPop();
  };

  window.PazifyStore = {
    config: CONFIG,
    state,
    selectPack,
    openOrder,
    showToast,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
