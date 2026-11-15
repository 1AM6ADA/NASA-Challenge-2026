// One shared tooltip. Values lead, labels follow; everything goes in with textContent.
FC.tip = (function () {
  let el;
  const ensure = () => el || (el = Object.assign(document.body.appendChild(document.createElement("div")), { className: "tip", hidden: true }));
  return {
    show(ev, title, rows) {
      const t = ensure();
      t.replaceChildren();
      if (title) { const d = document.createElement("div"); d.className = "t"; d.textContent = title; t.append(d); }
      for (const r of rows) {
        const row = document.createElement("div"); row.className = "r";
        const l = document.createElement("span");
        if (r.color) { const i = document.createElement("i"); i.style.background = r.color; l.append(i); }
        l.append(document.createTextNode(r.label || ""));
        const v = document.createElement("b"); v.textContent = r.value;
        row.append(l, v); t.append(row);
      }
      t.hidden = false;
      const w = t.offsetWidth, h = t.offsetHeight, pad = 14;
      let x = ev.clientX + pad, y = ev.clientY + pad;
      if (x + w > innerWidth - 8) x = ev.clientX - w - pad;
      if (y + h > innerHeight - 8) y = ev.clientY - h - pad;
      t.style.left = Math.max(8, x) + "px"; t.style.top = Math.max(8, y) + "px";
    },
    hide() { if (el) el.hidden = true; },
  };
})();
