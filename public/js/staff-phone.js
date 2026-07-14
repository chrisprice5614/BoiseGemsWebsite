(function (global) {
  "use strict";

  function digitsFromPhone(input) {
    var d = String(input || "").replace(/\D/g, "");
    if (d.length > 10 && d.charAt(0) === "1") d = d.slice(1);
    if (d.length > 10) d = d.slice(0, 10);
    return d;
  }

  function formatPhoneDisplay(digits) {
    var d = digitsFromPhone(digits);
    if (!d) return "";
    if (d.length <= 3) return "(" + d;
    if (d.length <= 6) return "(" + d.slice(0, 3) + ") " + d.slice(3);
    return "(" + d.slice(0, 3) + ") " + d.slice(3, 6) + " - " + d.slice(6);
  }

  function attachUSPhoneInput(input) {
    if (!input) return;

    function apply() {
      var prev = input.value;
      var start = input.selectionStart;
      var digitsBefore = digitsFromPhone(prev.slice(0, start)).length;
      var formatted = formatPhoneDisplay(prev);
      input.value = formatted;
      if (document.activeElement !== input) return;
      var pos = 0;
      var seen = 0;
      while (pos < formatted.length && seen < digitsBefore) {
        if (/\d/.test(formatted.charAt(pos))) seen++;
        pos++;
      }
      input.setSelectionRange(pos, pos);
    }

    input.addEventListener("input", apply);
    input.addEventListener("blur", apply);
    if (input.value) apply();
  }

  global.StaffPhone = {
    digitsFromPhone: digitsFromPhone,
    formatPhoneDisplay: formatPhoneDisplay,
    attachUSPhoneInput: attachUSPhoneInput,
  };
})(typeof window !== "undefined" ? window : globalThis);
