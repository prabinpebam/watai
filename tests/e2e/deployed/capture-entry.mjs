import { queryAllByRole } from '@testing-library/dom';
import { installCapture } from './capture.mjs';

export function install(flow) {
  window.__wataiCaptureAccessibleName = element => {
    const role = element.getAttribute('role') ?? ({ BUTTON: 'button', A: 'link', TEXTAREA: 'textbox', IMG: 'img', H1: 'heading', H2: 'heading' })[element.tagName];
    if (!role || !element.parentElement) return null;
    let result = null;
    queryAllByRole(element.parentElement, role, { hidden: true, name: (name, candidate) => {
      if (candidate === element) result = name;
      return false;
    } });
    return result;
  };
  installCapture(flow);
}