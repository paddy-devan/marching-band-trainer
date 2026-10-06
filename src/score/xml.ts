export function parseXml(text: string): Document {
  // No external entities or embedded document types are needed for native scores.
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('XML document types and entities are not supported.');
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Malformed score XML. Re-save the file in MuseScore.');
  return doc;
}
export const children = (el: Element, name: string) => Array.from(el.children).filter(c => c.localName === name);
export const child = (el: Element, name: string) => children(el, name)[0];
export const text = (el: Element | undefined, name?: string) => (name && el ? child(el, name) : el)?.textContent?.trim() || '';
export const number = (el: Element, name: string, fallback = 0) => text(el, name) ? Number(text(el, name)) : fallback;
