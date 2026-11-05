// Runs before the stylesheet so a saved Light or Dark choice is already on
// the document when the first paint happens. System leaves the attribute unset.
try {
  var storedTheme = localStorage.getItem('boffin.theme');
  if (storedTheme === 'light' || storedTheme === 'dark') {
    document.documentElement.setAttribute('data-theme', storedTheme);
    var themeColor = storedTheme === 'dark' ? '#0e1014' : '#f4f5f7';
    document.querySelectorAll('meta[name="theme-color"]').forEach(function (meta) {
      meta.setAttribute('content', themeColor);
      meta.removeAttribute('media');
    });
  }
  if (localStorage.getItem('boffin.size') === 'large') {
    document.documentElement.setAttribute('data-size', 'large');
  }
} catch {
  // Storage can be unavailable. The page then follows the device.
}
