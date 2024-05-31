export const XHR = {
  open: vi
    .spyOn(XMLHttpRequest.prototype, 'open')
    .mockImplementation(() => null),
  send: vi
    .spyOn(XMLHttpRequest.prototype, 'send')
    .mockImplementation(() => null),
  setRequestHeader: vi
    .spyOn(XMLHttpRequest.prototype, 'setRequestHeader')
    .mockImplementation(() => null),
};
