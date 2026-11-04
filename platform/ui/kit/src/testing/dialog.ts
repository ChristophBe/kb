/** jsdom has no modal dialogs; this toggles `open` like a browser would. Call it in a test file. */
export function polyfillDialog() {
  const proto = HTMLDialogElement.prototype;
  proto.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  proto.close ??= function (this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
}
