// Restore the game's identity whenever the player returns to this tab/window.
export function initTabBranding() {
  const title = document.title;
  const icon = document.querySelector('link[rel="icon"]');
  const originalIcon = icon?.getAttribute('href');
  const alternateIcon = new URL(`${import.meta.env.BASE_URL}alt-favicon.png`, document.baseURI).href;
  const update = () => {
    const inactive = document.hidden || !document.hasFocus();
    document.title = inactive ? 'retrac.space' : title;
    if (icon) icon.setAttribute('href', inactive ? alternateIcon : originalIcon);
  };
  window.addEventListener('blur', update);
  window.addEventListener('focus', update);
  document.addEventListener('visibilitychange', update);
  update();
}
