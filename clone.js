const Shopify = require("shopify-api-node");

const args = process.argv.slice(2);

if (args.length < 4) {
  console.log(`Fatal: 4 arguments required, but only ${args.length} provided. Run 'node clone.js <fromShopName> <fromAccessToken> <toShopName> <toAccessToken>'`);
  process.exit();
}

(async function (fromShopName, fromAccessToken, toShopName, toAccessToken) {
  const from = new Shopify({ autoLimit: { interval: 1500, bucketSize: 40, calls: 1 }, accessToken: fromAccessToken, shopName: fromShopName });

  const to = new Shopify({ autoLimit: { interval: 1500, bucketSize: 40, calls: 1 }, accessToken: toAccessToken, shopName: toShopName });

  async function* cloneSmartCollections(params = { limit: 250, published_status: "published" }) {
    const smartCollections = await from.smartCollection.list(params);

    for (const smartCollection of smartCollections) {
      const smartCollectionObject = {
        title: smartCollection.title,
        rules: smartCollection.rules,
        disjunctive: smartCollection.disjunctive,
        published_status: "published",
      };
      if (smartCollection.image) {
        Object.assign(smartCollectionObject, { image: { src: smartCollection.image.src } });
      }
      const { title } = await to.smartCollection.create(smartCollectionObject);
      yield title;
    }

    if (smartCollections.nextPageParameters) {
      return cloneSmartCollections(smartCollections.nextPageParameters);
    }
  }

  async function* cloneCustomCollections(params = { limit: 250, published_status: "published" }) {
    const customCollections = await from.customCollection.list(params);

    for (const customCollection of customCollections) {
      const customCollectionObject = {
        title: customCollection.title,
        published_status: "published",
      };
      if (customCollection.image) {
        Object.assign(customCollectionObject, { image: { src: customCollection.image.src } });
      }
      const { title } = await to.customCollection.create(customCollectionObject);
      yield title;
    }

    if (customCollections.nextPageParameters) {
      return cloneCustomCollections(customCollections.nextPageParameters);
    }
  }

  async function* cloneProducts(params = { limit: 250, published_status: "published" }) {
    const products = await from.product.list(params);

    async function _mapVariants(productVariants, productOptions, productImages, productId) {
      const imageMap = new Map();

      for (const productImage of productImages) {
        const { id } = await to.productImage.create(productId, {
          src: productImage.src,
          position: productImage.position,
        });
        imageMap.set(productImage.id, id);
      }

      await to.product.update(productId, {
        options: productOptions.map(({ name, position, values }) => {
          return { name, position, values };
        }),
        variants: productVariants.map(({ option1, option2, option3, price, compare_at_price, position, image_id }) => {
          const productVariantObject = { option1, option2, option3, price, compare_at_price, position, inventory_management: null };
          if (image_id) {
            Object.assign(productVariantObject, {
              image_id: imageMap.get(image_id),
            });
          }
          return productVariantObject;
        }),
      });
    }

    for (const product of products) {
      const productObject = {
        title: product.title,
        body_html: product.body_html,
        vendor: product.vendor,
        tags: product.tags,
      };
      const { id, title } = await to.product.create(productObject);
      await _mapVariants(product.variants, product.options, product.images, id);
      yield title;
    }

    if (products.nextPageParameters) {
      return cloneProducts(products.nextPageParameters);
    }
  }

  async function* clonePages(params = { limit: 250, published_status: "published" }) {
    const pages = await from.page.list(params);

    for (const page of pages) {
      const pageObject = { title: page.title, body_html: page.body_html, template_suffix: page.template_suffix };
      const { title } = await to.page.create(pageObject);
      yield title;
    }

    if (pages.nextPageParameters) {
      return clonePages(pages.nextPageParameters);
    }
  }

  async function exec(initialCount, generatorFn, object) {
    let execCount = 0;
    for (let generator = generatorFn(), curr = await generator.next(); !curr.done; curr = await generator.next(), curr = typeof curr.value === "object" && (generator = curr.value) ? await generator.next() : curr) {
      console.log(`>> ${++execCount} / ${initialCount} ${object}s cloned -- title: ${curr.value}`);
    }
  }

  const smartCollectionCount = await from.smartCollection.count({ published_status: "published" });
  const customCollectionCount = await from.customCollection.count({ published_status: "published" });
  const productCount = await from.product.count({ published_status: "published" });
  const pageCount = await from.page.count({ published_status: "published" });

  await exec(smartCollectionCount, cloneSmartCollections, "SmartCollection");
  await exec(customCollectionCount, cloneCustomCollections, "CustomCollection");
  await exec(productCount, cloneProducts, "Product");
  await exec(pageCount, clonePages, "Page");
})(...args);
