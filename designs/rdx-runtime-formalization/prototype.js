const variantButtons = Array.from(document.querySelectorAll('[data-variant]'));
const variantViews = Array.from(document.querySelectorAll('[data-variant-view]'));

variantButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const variant = button.dataset.variant;
    variantButtons.forEach((item) => item.classList.toggle('active', item === button));
    variantViews.forEach((view) => view.classList.toggle('hidden', view.dataset.variantView !== variant));
  });
});

const toggleInspector = document.querySelector('#toggle-inspector');
const inspector = document.querySelector('#inspector');
toggleInspector.addEventListener('click', () => {
  const expanded = toggleInspector.getAttribute('aria-expanded') === 'true';
  toggleInspector.setAttribute('aria-expanded', String(!expanded));
  inspector.classList.toggle('hidden', expanded);
});
