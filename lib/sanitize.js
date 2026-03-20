import sanitizeHtml from "sanitize-html";

// Safe tags and attributes for email rendering.
// Strips scripts, event handlers, iframes, and tracking pixels.
const ALLOWED_TAGS = [
  "p", "br", "b", "i", "u", "strong", "em", "s", "strike",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "blockquote", "pre", "code",
  "a", "span", "div", "table", "thead", "tbody", "tr", "th", "td",
  "img", "hr",
];

const ALLOWED_ATTRIBUTES = {
  a: ["href", "title", "target"],
  img: ["src", "alt", "width", "height"],
  "*": ["style", "class"],
};

// Strip external images (tracking pixels, privacy) and javascript: hrefs
function transformTags(tagName, attribs) {
  if (tagName === "a") {
    return {
      tagName,
      attribs: {
        ...attribs,
        target: "_blank",
        rel: "noopener noreferrer",
        // Block javascript: links
        href: /^javascript:/i.test(attribs.href ?? "") ? "#" : (attribs.href ?? "#"),
      },
    };
  }
  if (tagName === "img") {
    // Block tracking pixels (1x1 images) and external images by default
    const w = parseInt(attribs.width ?? "0");
    const h = parseInt(attribs.height ?? "0");
    if ((w === 1 && h === 1) || (w <= 1 && h <= 1)) {
      return { tagName: "span", attribs: {} }; // drop tracking pixel
    }
  }
  return { tagName, attribs };
}

export function sanitizeEmailHtml(html) {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    transformTags: {
      a: transformTags.bind(null, "a"),
      img: transformTags.bind(null, "img"),
    },
  });
}

// Extract the best body from a Gmail MIME payload.
// Prefers text/html for rich rendering; falls back to text/plain.
export function extractBody(payload) {
  return (
    findPart(payload, "text/html") ||
    findPart(payload, "text/plain") ||
    ""
  );
}

export function extractIsHtml(payload) {
  return !!findPart(payload, "text/html");
}

function findPart(payload, mimeType) {
  if (!payload) return null;
  if (payload.mimeType === mimeType && payload.body?.data) {
    return Buffer.from(payload.body.data, "base64").toString("utf-8");
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      const result = findPart(part, mimeType);
      if (result) return result;
    }
  }
  return null;
}
