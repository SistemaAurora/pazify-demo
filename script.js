/* =========================================================
   Pazify — compra contra entrega en Perú
   Configura tu WhatsApp y desactiva el modo demo para vender.
   ========================================================= */

(() => {
  "use strict";

  const CONFIG = {
    demoMode: true,
    whatsapp: "", // Ejemplo: "51987654321" (código de país + número, sin + ni espacios).
    currency: "PEN",
    product: {
      name: "Pazify 3 en 1",
      image: "assets/img/product-cutout.webp",
    },
    packs: {
      1: { units: 1, price: 89.9, perUnit: 89.9, label: "1 unidad", savings: 0 },
      2: { units: 2, price: 149.9, perUnit: 74.95, label: "2 unidades", savings: 29.9 },
      3: { units: 3, price: 199.9, perUnit: 66.63, label: "3 unidades", savings: 69.8 },
    },
    offerPopDelay: 12000,
    orderEndpoint: "", // URL que recibe POST JSON y devuelve {ok:true, orderId:"..."}.
    orderEndpointTimeout: 15000,
    analytics: {
      gtmId: "",
      ga4Id: "",
      metaPixelId: "",
    },
  };

  const OFFER_KEY = "pazify_offer_pop_seen";
  const CONSENT_KEY = "pazify_consent_v1";
  const isDemo = () => CONFIG.demoMode || !CONFIG.orderEndpoint;

  const state = {
    selectedPack: 1,
    orderStarted: false,
    submitting: false,
    lastOrderText: "",
    lastOrderCode: "",
    lastOrderDemo: true,
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const els = {
    header: $("[data-header]"),
    overlay: $("[data-overlay]"),
    price: $("[data-price]"),
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
    demoBanner: $("[data-demo-banner]"),
    demoOrderNote: $("[data-demo-order-note]"),
    orderPackLabel: $("[data-order-pack-label]"),
    orderPackPrice: $("[data-order-pack-price]"),
    orderTotal: $("[data-order-total]"),
    galleryMain: $("[data-gallery-main]"),
    galleryThumbs: $$("[data-gallery-thumbs] .thumb"),
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
    whatsapp_click: "WhatsAppClick",
    offer_pop_view: "OfferPopView",
    faq_open: "FAQOpen",
    scroll_depth: "ScrollDepth",
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
      if (metaEvent === "SelectPack") window.fbq("trackCustom", metaEvent, data);
      else window.fbq("track", metaEvent, data);
    }

    document.dispatchEvent(new CustomEvent("pazify:track", { detail: payload }));
    if (new URLSearchParams(window.location.search).has("debug")) {
      console.debug("[pazify]", event, data);
    }
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

  /* ---------- Packs ---------- */

  const syncPackUI = () => {
    const pack = CONFIG.packs[state.selectedPack] || CONFIG.packs[1];

    if (els.price) els.price.textContent = money(pack.price);
    if (els.priceNote) els.priceNote.textContent = `${pack.label} · ${money(pack.perUnit)} c/u`;
    if (els.priceBadge) els.priceBadge.textContent = "Envío gratis";
    if (els.orderPriceCta) els.orderPriceCta.textContent = money(pack.price);
    if (els.mobilePrice) els.mobilePrice.textContent = money(pack.price);
    if (els.orderPackLabel) els.orderPackLabel.textContent = pack.label;
    if (els.orderPackPrice) els.orderPackPrice.textContent = money(pack.price);
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

  const getOrderCode = (demo = false) => {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `${demo ? "DEMO" : "PZ"}-${date}-${suffix}`;
  };

  const deliveryLabel = (value) =>
    value === "agencia" ? "Recojo en agencia (coordinar)" : "Entrega a domicilio";

  const applyDemoState = () => {
    const demo = isDemo();
    document.querySelectorAll("[data-demo-only]").forEach((element) => {
      element.hidden = !demo;
    });
    document.querySelectorAll("[data-production-only]").forEach((element) => {
      element.hidden = demo;
    });
    if (els.demoBanner) els.demoBanner.hidden = !demo;
    if (els.demoOrderNote) els.demoOrderNote.hidden = !demo;
    if (els.orderSuccessTitle && !els.orderModal?.classList.contains("is-success")) {
      els.orderSuccessTitle.textContent = demo ? "Vista previa del pedido" : "Pedido registrado";
    }
    document.body.dataset.demo = demo ? "true" : "false";
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
    }
    if (els.orderStatus) els.orderStatus.textContent = "";
    applyDemoState();
  };

  const openOrder = () => {
    if (!els.orderModal) return;
    state.orderStarted = true;
    if (els.orderSuccess && !els.orderSuccess.hidden) resetOrderModal();
    else if (els.orderSuccess) els.orderSuccess.hidden = true;
    if (els.orderForm) els.orderForm.hidden = false;
    applyDemoState();
    syncPackUI();
    openDialog(els.orderModal);
    track("begin_checkout", {
      currency: CONFIG.currency,
      value: CONFIG.packs[state.selectedPack].price,
      item_variant: CONFIG.packs[state.selectedPack].label,
    });
  };

  const buildOrderText = (data, orderCode, demo = false) => {
    const pack = CONFIG.packs[state.selectedPack];
    const lines = [
      demo ? "PEDIDO DE DEMOSTRACIÓN — NO REGISTRADO" : "Hola Pazify 👋 Quiero confirmar este pedido contra entrega:",
      "",
      `Código de pedido: ${orderCode}`,
      `Producto: ${CONFIG.product.name}`,
      `Pack: ${pack.label}`,
      `Cantidad: ${pack.units} unidad(es)`,
      `Precio total: ${money(pack.price)}`,
      `Modalidad de entrega: ${deliveryLabel(data.delivery)}`,
      "",
      "Envío: Gratis a todo el Perú (sujeto a cobertura)",
      "Método de pago: contra entrega",
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

  const showOrderSuccess = ({ title, message, code, demo = false }) => {
    const card = $(".modal-order", els.orderModal);
    if (card) card.classList.add("is-success");
    if (els.orderModal) els.orderModal.setAttribute("aria-labelledby", "order-success-title");
    if (els.orderSuccessTitle) els.orderSuccessTitle.textContent = title;
    if (els.orderSuccess) els.orderSuccess.hidden = false;
    if (els.orderForm) els.orderForm.hidden = true;
    if (els.orderStatus) els.orderStatus.textContent = "";
    if (els.orderSuccessMessage) els.orderSuccessMessage.textContent = message;
    if (els.orderCode) els.orderCode.textContent = code;
    document.body.dataset.lastOrderDemo = demo ? "true" : "false";
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
      city: String(formData.get("city") || "").trim(),
      address: String(formData.get("address") || "").trim(),
      reference: String(formData.get("reference") || "").trim(),
      delivery: String(formData.get("delivery") || "domicilio"),
    };

    const pack = CONFIG.packs[state.selectedPack];
    const demo = isDemo();
    const localCode = getOrderCode(demo);
    const submitButton = els.orderForm.querySelector('button[type="submit"]');

    state.lastOrderCode = localCode;
    state.lastOrderDemo = demo;
    state.lastOrderText = buildOrderText(data, localCode, demo);

    if (demo) {
      showOrderSuccess({
        title: "Vista previa del pedido",
        message: "Este pedido no se ha registrado. El sitio está en modo demostración; configura un endpoint de pedidos para activar la tienda real.",
        code: localCode,
        demo: true,
      });
      track("demo_order_preview", {
        currency: CONFIG.currency,
        value: pack.price,
        pack: pack.label,
        demo: true,
      });
      showToast("Vista previa creada. No se ha registrado ningún pedido.");
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
          delivery: data.delivery,
          pack: state.selectedPack,
          packLabel: pack.label,
          quantity: pack.units,
          price: pack.price,
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
      state.lastOrderText = buildOrderText(data, serverCode, false);

      showOrderSuccess({
        title: "Pedido registrado",
        message: CONFIG.whatsapp
          ? "Pedido registrado. Abrimos WhatsApp para confirmar la entrega y coordinar el pago contra entrega."
          : "Pedido registrado. Nos pondremos en contacto para confirmar la entrega. Pagas al recibir.",
        code: serverCode,
        demo: false,
      });

      track("order_created", {
        transaction_id: serverCode,
        currency: CONFIG.currency,
        value: pack.price,
        shipping: 0,
        status: "created",
        items: [{ item_name: `${CONFIG.product.name} — ${pack.label}`, price: pack.price, quantity: 1 }],
      });

      if (CONFIG.whatsapp) {
        const url = `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(state.lastOrderText)}`;
        const whatsappWindow = window.open(url, "_blank");
        if (whatsappWindow) {
          whatsappWindow.opener = null;
          track("whatsapp_click", { location: "order", order_id: serverCode });
        } else if (els.orderStatus) {
          els.orderStatus.textContent = "Pedido registrado. Permite las ventanas emergentes para abrir WhatsApp.";
        }
      }
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

  const setGalleryImage = (thumb) => {
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
    track("gallery_view", { image: src });
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
        if (!CONFIG.whatsapp || CONFIG.demoMode) {
          event.preventDefault();
          showToast("Configura tu número de WhatsApp en script.js para activar este botón.");
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

  const setupMobileBar = () => {
    if (!els.mobileBar || !els.buySection) return;
    if (!("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(([entry]) => {
      const show = !entry.isIntersecting || window.scrollY < 200;
      els.mobileBar.classList.toggle("is-visible", show);
      document.body.classList.toggle("has-mobile-bar", show);
    }, { threshold: 0 });
    observer.observe(els.buySection);
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
    applyDemoState();
    setupExternalLinks();
    bindEvents();
    setupVideo();
    setupConsent();
    setupReveal();
    setupScrollDepth();
    setupHeader();
    setupMobileBar();
    setupOfferPop();

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

  window.PazifyStore = {
    config: CONFIG,
    state,
    selectPack,
    openOrder,
    showToast,
    applyDemoState,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
