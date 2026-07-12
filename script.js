const galleryPages = {
  '3d-art': [
    { src: 'Image/3D ART/3D Personal/01.jpg', title: '3D Personal 01' },
    { src: 'Image/3D ART/3D Professional/003 (1).png', title: '3D Professional 01' },
    { src: 'Image/3D ART/3D Professional/1550821730285.jpg', title: '3D Professional 02' },
    { src: 'Image/3D ART/3D Professional/2012_06.jpg', title: '3D Professional 03' }
  ],
  '2d-art': [
    { src: 'Image/2D ART/2D Personal/Guide03-1.jpg', title: '2D Personal 01' },
    { src: 'Image/2D ART/2D Professional/로고 뷰 .jpg', title: '2D Professional 01' },
    { src: 'Image/2D ART/2D Professional/연대 치대 음악 동아리 Yeoul 공연 포스터.jpg', title: '2D Professional 02' },
    { src: 'Image/2D ART/2D Professional/홈페이지 제작 외주.jpg', title: '2D Professional 03' }
  ],
  'dear-father': [
    { src: 'Image/DEAR FATHER/Dear Father_01.webp', title: '' },
    { src: 'Image/DEAR FATHER/Dear Father_02.webp', title: '' },
    { src: 'Image/DEAR FATHER/Dear Father_03.webp', title: '' },
    { src: 'Image/DEAR FATHER/Dear Father_04.webp', title: '' },
    { src: 'Image/DEAR FATHER/Dear Father_05.webp', title: '' },
    { src: 'Image/DEAR FATHER/Dear Father_06.webp', title: '' },
    { src: 'Image/DEAR FATHER/Dear Father_07.webp', title: '' },
    { src: 'Image/DEAR FATHER/Dear Father_08.webp', title: '' },
    { src: 'Image/DEAR FATHER/Dear Father_09.webp', title: '' },
    { src: 'Image/DEAR FATHER/Dear Father_10.webp', title: '' },
    { src: 'Image/DEAR FATHER/Dear Father_11.webp', title: '' },
    { src: 'Image/DEAR FATHER/Dear Father_12.webp', title: '' },
    { src: 'Image/DEAR FATHER/Dear Father_13.webp', title: '' },
    { src: 'Image/DEAR FATHER/Dear Father_14.webp', title: '' },
    { src: 'Image/DEAR FATHER/Dear Father_15.webp', title: '' },
    { src: 'Image/DEAR FATHER/Dear Father_16.webp', title: '' },
    { src: 'Image/DEAR FATHER/Dear Father_17.webp', title: '' },
    { src: 'Image/DEAR FATHER/Dear Father_18.webp', title: '' },
    { src: 'Image/DEAR FATHER/Dear Father_19.webp', title: '' },
    { src: 'Image/DEAR FATHER/Dear Father_20.webp', title: '' },
    { src: 'Image/DEAR FATHER/Dear Father_21.webp', title: '' },
    { src: 'Image/DEAR FATHER/Dear Father_22.webp', title: '' },
    { src: 'Image/DEAR FATHER/Dear Father_23.webp', title: '' },
    { src: 'Image/DEAR FATHER/Dear Father_24.webp', title: '' },
    { src: 'Image/DEAR FATHER/Dear Father_25.webp', title: '' },
    { src: 'Image/DEAR FATHER/Dear Father_26.webp', title: '' },
    { src: 'Image/DEAR FATHER/Dear Father_27.webp', title: '' },
    { src: 'Image/DEAR FATHER/Dear Father_28.webp', title: '' },
    { src: 'Image/DEAR FATHER/Dear Father_29.webp', title: '' },
    { src: 'Image/DEAR FATHER/Dear Father_30.webp', title: '' },
    { src: 'Image/DEAR FATHER/Dear Father_31.webp', title: '' },
    { src: 'Image/DEAR FATHER/Dear Father_32.webp', title: '' }
  ]
};

const body = document.body;
const pageKey = body.dataset.page;
const galleryContainer = document.querySelector('[data-gallery]');

function buildGallery() {
  if (!galleryContainer) return;

  const items = galleryPages[pageKey] || [];
  galleryContainer.innerHTML = '';

  items.forEach((item, index) => {
    const card = document.createElement('article');
    card.className = 'gallery-item';
    card.innerHTML = `
      <img src="${item.src}" alt="${item.title}" loading="lazy" />
      <div class="gallery-meta">${item.title}</div>
    `;
    card.addEventListener('click', () => openLightbox(index));
    galleryContainer.appendChild(card);
  });
}

const lightbox = document.querySelector('.lightbox');
const lightboxImg = lightbox?.querySelector('img');
const lightboxCaption = lightbox?.querySelector('.lightbox-caption');
const closeButton = document.querySelector('.lightbox-close');
const prevButton = document.querySelector('.lightbox-nav.prev');
const nextButton = document.querySelector('.lightbox-nav.next');
let currentIndex = 0;
let currentItems = [];

function openLightbox(index) {
  if (!lightbox || !lightboxImg) return;
  currentItems = galleryPages[pageKey] || [];
  currentIndex = index;
  updateLightbox();
  lightbox.classList.add('open');
  lightbox.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function updateLightbox() {
  if (!currentItems.length) return;
  const item = currentItems[currentIndex];
  if (!item) return;
  lightboxImg.src = item.src;
  lightboxImg.alt = item.title;
  lightboxCaption.textContent = item.title;
}

function closeLightbox() {
  lightbox?.classList.remove('open');
  lightbox?.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

function showPrev() {
  if (!currentItems.length) return;
  currentIndex = (currentIndex - 1 + currentItems.length) % currentItems.length;
  updateLightbox();
}

function showNext() {
  if (!currentItems.length) return;
  currentIndex = (currentIndex + 1) % currentItems.length;
  updateLightbox();
}

closeButton?.addEventListener('click', closeLightbox);
prevButton?.addEventListener('click', showPrev);
nextButton?.addEventListener('click', showNext);
lightbox?.addEventListener('click', (event) => {
  if (event.target === lightbox) {
    closeLightbox();
  }
});

document.addEventListener('keydown', (event) => {
  if (!lightbox?.classList.contains('open')) return;
  if (event.key === 'Escape') closeLightbox();
  if (event.key === 'ArrowLeft') showPrev();
  if (event.key === 'ArrowRight') showNext();
});

const toggle = document.querySelector('.menu-toggle');
const nav = document.querySelector('.site-nav');

toggle?.addEventListener('click', () => {
  const isOpen = nav?.classList.toggle('open');
  toggle.setAttribute('aria-expanded', String(isOpen));
});

buildGallery();
