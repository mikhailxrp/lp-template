(function () {
	'use strict';

	// В WP jQuery работает в режиме noConflict: глобального $ нет
	const $ = window.jQuery;

	// Хуки только через data-js="имя", не через классы.
	// const initSomething = () => {
	//   const el = document.querySelector('[data-js="something"]');
	//   if (!el) return;
	// };

	document.addEventListener('DOMContentLoaded', () => {
		// initSomething();
	});
})();
