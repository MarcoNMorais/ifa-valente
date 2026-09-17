(() => {
  const sidebar = document.getElementById("ig-sidebar");
  const overlay = document.getElementById("sidebar-overlay");
  const menuButton = document.getElementById("menu-button");

  const closeSidebar = () => sidebar?.classList.remove("open");
  menuButton?.addEventListener("click", () => sidebar?.classList.add("open"));
  overlay?.addEventListener("click", closeSidebar);

  document.querySelectorAll("[data-open]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = document.getElementById(button.dataset.open);
      if (target instanceof HTMLDialogElement) target.showModal();
    });
  });

  document.querySelectorAll("[data-close]").forEach((button) => {
    button.addEventListener("click", () => button.closest("dialog")?.close());
  });

  document.querySelectorAll("dialog").forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
  });

  const search = document.getElementById("transaction-search");
  search?.addEventListener("input", () => {
    const term = search.value.trim().toLocaleLowerCase("pt-BR");
    document.querySelectorAll("#transactions-table tbody tr").forEach((row) => {
      row.hidden = !row.dataset.search.includes(term);
    });
  });
})();
