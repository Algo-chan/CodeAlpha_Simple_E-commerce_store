# Assets

```
images/   product photos, category banners, illustrations
  products/<slug>/  demo catalogue photos, one WebP per angle + a -thumb
icons/    SVG icons (inline or as files)
fonts/    reserved for the brand webfonts chosen in the design phase
```

`images/products/` holds the **demo** catalogue photographs (`<angle>.webp` plus
an `<angle>-thumb.webp` rendition). `mock/products.js` names the angles per
product and `mock/media.js` builds the URLs, so replacing them with the real
imagery means dropping in new files and updating those `photos` lists - see
`images/products/CREDITS.md` for the current sources and licences. Products
without photos still fall back to the procedural SVGs in `mock/media.js`.

Icons should be SVGs so they inherit `currentColor`, and any raster image should
be WebP/AVIF with explicit dimensions to avoid layout shift. `images/` will also
carry category banners and illustrations once the brand identity lands.