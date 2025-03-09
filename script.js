// Format date (YYYYMMDD to MM/DD/YYYY or "Unknown")
function formatDate(date) {
    if (!date || date === 'Unknown') return 'Unknown';
    const year = date.slice(0, 4);
    const month = date.slice(4, 6);
    const day = date.slice(6, 8);
    return `${month}/${day}/${year}`;
  }
  
  document.getElementById('searchForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const drugName = document.getElementById('drugName').value.trim();
    if (!drugName) return;
  
    const resultsDiv = document.getElementById('results');
    resultsDiv.innerHTML = '<p class="text-gray-500 text-center">Loading...</p>';
  
    try {
      const response = await fetch(`http://localhost:3000/api/drug/${encodeURIComponent(drugName)}`);
      if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
      const data = await response.json();
  
      if (data.error) {
        resultsDiv.innerHTML = `<p class="text-red-500 text-center">${data.error}</p>`;
        return;
      }
  
      let html = '';
      for (const [brandName, strengths] of Object.entries(data)) {
        html += `
          <div class="border p-4 rounded-lg bg-gray-50">
            <h2 class="text-xl font-semibold text-blue-600">${brandName}</h2>
            <div class="mt-2 space-y-3">
        `;
  
        for (const [strength, entries] of Object.entries(strengths)) {
          html += `
            <div class="border-l-4 border-blue-400 pl-3">
              <h3 class="text-lg font-medium">${strength}</h3>
              <ul class="space-y-2">
          `;
  
          entries.forEach((entry, index) => {
            html += `
              <li class="flex justify-between items-center">
                <span>App: ${entry.applicationNumber} | Date: ${formatDate(entry.approvalDate)}</span>
                <button 
                  class="text-blue-500 hover:underline text-sm" 
                  onclick="showModal(${JSON.stringify(entry).replace(/'/g, "\\'")})"
                >
                  Details
                </button>
              </li>
            `;
          });
  
          html += `</ul></div>`;
        }
  
        html += `</div></div>`;
      }
  
      resultsDiv.innerHTML = html || '<p class="text-gray-500 text-center">No results found.</p>';
    } catch (error) {
      console.error('Fetch error:', error); // Log error for debugging
      resultsDiv.innerHTML = `<p class="text-red-500 text-center">Error: ${error.message}</p>`;
    }
  });
  
  // Modal functions
  function showModal(entry) {
    console.log('Modal entry:', entry); // Debug: Check if entry is received
    const modal = document.getElementById('modal');
    const modalContent = document.getElementById('modalContent');
  
    if (!entry || typeof entry !== 'object') {
      modalContent.innerHTML = '<p class="text-red-500">Error: No data available.</p>';
      modal.classList.add('show');
      return;
    }
  
    modalContent.innerHTML = `
      <p><strong>Application:</strong> ${entry.applicationNumber || 'N/A'}</p>
      <p><strong>Approval Date:</strong> ${formatDate(entry.approvalDate) || 'N/A'}</p>
      <p><strong>Sponsor:</strong> ${entry.sponsorName || 'N/A'}</p>
      <p><strong>Active Ingredients:</strong> ${entry.activeIngredients?.map(ing => `${ing.name} ${ing.strength}`).join(', ') || 'N/A'}</p>
      <p><strong>FDA Page:</strong> <a href="${entry.fdaPage || '#'}" target="_blank" class="text-blue-500 hover:underline">View on Drugs@FDA</a></p>
      <p><strong>Documents:</strong></p>
      <ul class="list-disc pl-5">
        <li><a href="${entry.pdfLinks?.approvalLetter || '#'}" target="_blank" class="text-blue-500 hover:underline">Approval Letter</a></li>
        <li><a href="${entry.pdfLinks?.labeling || '#'}" target="_blank" class="text-blue-500 hover:underline">Printed Labeling</a></li>
        <li><a href="${entry.pdfLinks?.medicalReview || '#'}" target="_blank" class="text-blue-500 hover:underline">Medical Review</a></li>
        <li><a href="${entry.pdfLinks?.chemistryReview || '#'}" target="_blank" class="text-blue-500 hover:underline">Chemistry Review</a></li>
        <li><a href="${entry.pdfLinks?.clinicalPharmaReview || '#'}" target="_blank" class="text-blue-500 hover:underline">Clinical Pharmacology Review</a></li>
        <li><a href="${entry.pdfLinks?.adminDocs || '#'}" target="_blank" class="text-blue-500 hover:underline">Administrative Documents</a></li>
        <li><a href="${entry.pdfLinks?.correspondence || '#'}" target="_blank" class="text-blue-500 hover:underline">Correspondence</a></li>
      </ul>
    `;
  
    modal.classList.add('show');
  }
  
  function closeModal() {
    document.getElementById('modal').classList.remove('show');
  }
  
  document.getElementById('closeModal').addEventListener('click', closeModal);