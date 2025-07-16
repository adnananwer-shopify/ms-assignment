// cart monitoring

let globalCart = null;

const cartDrawerElement = document.querySelector('cart-notification') || document.querySelector('cart-drawer');

document.addEventListener('DOMContentLoaded', () => {
  initGlobalCart();

  // grid add to cart custom
  const addToCartButtons = document.querySelectorAll('.product-card__button-custom');
  addToCartButtons.forEach((button) => {
    button.addEventListener('click', async function (event) {
      event.preventDefault();

      const productForm = button.closest('form');
      let formData = new FormData(productForm);

      const originalButtonText = this.textContent;
      this.textContent = 'Adding...';
      this.disabled = true;

      formData = isFreeSampleEligible(formData);

      try {
        await addItemToCart(formData);
        this.textContent = 'Added!';
      } catch {
        this.textContent = 'Error';
      }

      setTimeout(() => {
        this.textContent = originalButtonText;
        this.disabled = false;
      }, 2000);
    });
  });

  // secured shipping
  document.addEventListener('change', async (event) => {
    if (event.target && event.target.id === 'securedShipping') {
      const formData = new FormData();
      const source_template = event.target.dataset.templateSource;
      formData.append('id', event.target.value);
      formData.append('properties[_addon_product]', true);
      formData.append('properties[_source_template]', source_template);
      await addItemToCart(formData);
    }
  });

  // giftwrap
  document.addEventListener('change', (event) => {
    if (event.target && event.target.id === 'addGiftWrap') {
      const wrapper = document.getElementById('giftMessageWrapper');
      if (wrapper) {
        wrapper.style.display = event.target.checked ? 'block' : 'none';
      }
    }
  });

  document.addEventListener('click', async (event) => {
    if (event.target && event.target.id === 'giftMessageWrapperBtn') {
      event.preventDefault();

      const button = event.target;
      const variantId = button.dataset.giftProduct;
      const source_template = button.dataset.templateSource;
      const message = document.getElementById('giftMessage').value.trim();

      if (!message) {
        alert('please enter a gift message.');
        return;
      }

      const formData = new FormData();
      formData.append('id', variantId);
      formData.append('quantity', 1);
      formData.append('properties[Customizable Message]', message);
      formData.append('properties[_addon_product]', true);
      formData.append('properties[_source_template]', source_template);

      const originalText = button.textContent;
      button.textContent = 'Adding...';
      button.disabled = true;

      try {
        await addItemToCart(formData);
        button.textContent = 'Added!';
      } catch {
        button.textContent = 'Error';
      }

      setTimeout(() => {
        button.textContent = originalText;
        button.disabled = false;
      }, 2000);
    }
  });
});

document.addEventListener('cart:updated', async function (event) {
  const cartData = event.detail.cart;
  const items = cartData.items || [];

  const itemsByTemplate = new Map();

  // Group items by _source_template
  items.forEach((item) => {
    const props = item.properties || {};
    const template = props._source_template || null;
    const isAddon = props._addon_product === 'true';
    const isFree = item.price === 0;

    if (!template) return;

    if (!itemsByTemplate.has(template)) {
      itemsByTemplate.set(template, { regular: [], others: [] });
    }

    if (!isAddon && !isFree) {
      itemsByTemplate.get(template).regular.push(item);
    } else {
      itemsByTemplate.get(template).others.push(item);
    }
  });
  console.log(itemsByTemplate);
  // Collect keys to remove for templates with no regular products
  const keysToRemove = [];

  for (const [template, group] of itemsByTemplate.entries()) {
    if (group.regular.length === 0 && group.others.length > 0) {
      group.others.forEach((item) => {
        keysToRemove.push(item.key);
      });
    }
  }

  if (keysToRemove.length === 0) return;

  // build the updates object using keys
  const updates = {};
  keysToRemove.forEach((key) => {
    updates[key] = 0;
  });

  const payload = {
    updates,
    sections: cartDrawerElement.getSectionsToRender().map((section) => section.id),
    sections_url: window.location.pathname,
  };

  try {
    const res = await fetch('/cart/update', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      const result = await res.json();
      cartDrawerElement.renderContents(result);
      if (result.item_count === 0) {
        cartDrawerElement.classList.add('is-empty');
      }
    } else {
      console.error('Failed to update cart:', res.statusText);
    }
  } catch (err) {
    console.error('Error updating cart:', err);
  }
});

// add to cart function
function addItemToCart(formData) {
  return new Promise(async (resolve, reject) => {
    try {
      formData.append(
        'sections',
        cartDrawerElement
          .getSectionsToRender()
          .map((section) => section.id)
          .join(',')
      );
      formData.append('sections_url', window.location.pathname);
      cartDrawerElement.setActiveElement(document.activeElement);

      const addResponse = await fetch('/cart/add', {
        method: 'POST',
        body: formData,
        headers: { Accept: 'application/json' },
      });

      if (!addResponse.ok) {
        const errorText = await addResponse.text();
        throw new Error(`failed to add item to cart: ${errorText}`);
      }

      const result = await addResponse.json();
      publish(PUB_SUB_EVENTS.cartUpdate, { source: 'product-form', productVariantId: formData.get('id') });
      cartDrawerElement.renderContents(result);
      if (cartDrawerElement.classList.contains('is-empty')) {
        cartDrawerElement.classList.remove('is-empty');
      }

      resolve(result);
    } catch (error) {
      console.error('error adding item to cart:', error);
      reject(error);
    }
  });
}

// cart monitor function

function initGlobalCart() {
  monitorShopifyCartUpdates();
  updateGlobalCart();
}

function monitorShopifyCartUpdates() {
  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    const [url] = args;
    if (isCartMutationRequest(url)) {
      return originalFetch.apply(this, args).then((response) => {
        if (response.ok) updateGlobalCart();
        return response;
      });
    }
    return originalFetch.apply(this, args);
  };
}

// detect if the url is related to cart
function isCartMutationRequest(url) {
  return typeof url === 'string' && /\/cart\/(add|change|update|clear|remove)(\.js)?/.test(url);
}

// fetch the cart and update globalcart
function updateGlobalCart() {
  setTimeout(() => {
    fetch('/cart.js')
      .then((res) => res.json())
      .then((cart) => {
        globalCart = cart;
        document.dispatchEvent(
          new CustomEvent('cart:updated', {
            detail: { cart: globalCart },
          })
        );
      })
      .catch((err) => console.error('failed to fetch cart:', err));
  }, 100);
}

// check free eligible - function
function isFreeSampleEligible(formData) {
  const freeSample = Math.round(formData.get('free-sample'));
  if (freeSample) {
    const sampleExists = globalCart?.items?.some((item) => item.id === freeSample);
    if (sampleExists) {
      formData.delete('items[1][id]');
      formData.delete('items[1][properties][_source_template]');
    }
  }
  return formData;
}
