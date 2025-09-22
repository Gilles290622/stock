import React from "react";
import { formatInt } from "../../utils/format";

const AddRow = ({
  // refs
  rowRef,
  dateRef,
  typeRef,
  designationRef,
  quantiteRef,
  prixRef,
  clientRef,

  // data
  formData,

  // handlers
  onDateInput,
  onTypeInput,
  handleCellKeyDown,
  handleDesignationInput,
  selectDesignation,
  clearDesignationSuggestions,
  handleNumericKeyDown,
  handleIntInput,
  handleClientInput,
  selectClient,
  clearClientSuggestions,
  handleClientKeyDown,

  // suggestions
  designationSuggestions,
  clientSuggestions,
}) => {
  return (
    <tr className="bg-gray-50" ref={rowRef}>
      {/* Col sélection */}
      <td className="py-3 px-2 border-b text-center text-gray-400 select-none">—</td>

      {/* # */}
      <td className="py-3 bg-gray-100 px-2 border-b text-gray-400 select-none">—</td>

      {/* Date */}
      <td
        className="py-3 px-4 border-b"
        contentEditable
        suppressContentEditableWarning
        ref={dateRef}
        onInput={onDateInput}
        onKeyDown={handleCellKeyDown(typeRef)}
        dir="ltr"
        style={{ textAlign: "left" }}
      >
        {formData.date}
      </td>

      {/* Type (saisie) */}
      <td
        className="py-3 px-4 border-b bg-gray-100"
        contentEditable
        suppressContentEditableWarning
        ref={typeRef}
        onInput={onTypeInput}
        onKeyDown={handleCellKeyDown(designationRef)}
        dir="ltr"
        style={{ textAlign: "left" }}
      >
        {formData.type}
      </td>

      {/* Désignation (saisie) */}
      <td className="py-3 px-4 border-b relative" style={{ minWidth: 160 }}>
        <div
          ref={designationRef}
          className="outline-none min-h-[1.5rem]"
          contentEditable
          suppressContentEditableWarning
          onInput={handleDesignationInput}
          onKeyDown={handleCellKeyDown(quantiteRef)}
          onBlur={() => setTimeout(() => clearDesignationSuggestions(), 200)}
          dir="ltr"
          style={{ textAlign: "left" }}
        />
        {designationSuggestions?.length > 0 && (
          <ul className="absolute left-0 top-full w-full bg-white border border-gray-300 rounded mt-1 max-h-40 overflow-y-auto shadow-lg z-10">
            {designationSuggestions.map((des) => (
              <li
                key={des.id}
                onMouseDown={(e) => selectDesignation(e, des.name, des.id)}
                className="px-2 py-1 hover:bg-gray-100 cursor-pointer text-sm border-b border-gray-200 last:border-b-0"
              >
                {des.name}
              </li>
            ))}
          </ul>
        )}
      </td>

      {/* Stock (readonly) */}
      <td className="py-3 px-4 border-b bg-gray-100 text-right tabular-nums">
        {formatInt(formData.stock)}
      </td>

      {/* Quantité (editable) */}
      <td
        className="py-3 px-4 border-b text-right tabular-nums"
        contentEditable
        suppressContentEditableWarning
        ref={quantiteRef}
        onKeyDown={handleNumericKeyDown(prixRef)}
        onInput={handleIntInput("quantite")}
        onFocus={(e) => e.currentTarget && e.currentTarget.focus()}
        dir="ltr"
        style={{ textAlign: "right" }}
      />

      {/* Prix (editable) */}
      <td
        className="py-3 px-4 border-b bg-gray-100 text-right tabular-nums"
        contentEditable
        suppressContentEditableWarning
        ref={prixRef}
        onKeyDown={handleNumericKeyDown(clientRef)}
        onInput={handleIntInput("prix")}
        onFocus={(e) => e.currentTarget && e.currentTarget.focus()}
        dir="ltr"
        style={{ textAlign: "right" }}
      />

      {/* Montant (readonly) */}
      <td className="py-3 px-4 border-b  font-medium text-right tabular-nums">
        {formatInt(formData.montant)}
      </td>

      {/* Client (saisie) */}
      <td className="py-3 px-4 border-b bg-gray-100 relative" style={{ minWidth: 160 }}>
        <div
          ref={clientRef}
          className="outline-none min-h-[1.5rem]"
          contentEditable
          suppressContentEditableWarning
          onInput={handleClientInput}
          onKeyDown={handleClientKeyDown}
          onBlur={() => setTimeout(() => clearClientSuggestions(), 200)}
          dir="ltr"
          style={{ textAlign: "left" }}
        />
        {clientSuggestions?.length > 0 && (
          <ul className="absolute left-0 top-full w-full bg-white border border-gray-300 rounded mt-1 max-h-40 overflow-y-auto shadow-lg z-10">
            {clientSuggestions.map((cli) => (
              <li
                key={cli.id}
                onMouseDown={(e) => selectClient(e, cli.name, cli.id)}
                className="px-2 py-1 hover:bg-gray-100 cursor-pointer text-sm border-b border-gray-200 last:border-b-0"
              >
                {cli.name}
              </li>
            ))}
          </ul>
        )}
      </td>

      {/* Stock Restant (readonly) */}
      <td className="py-3 px-4 border-b  font-semibold text-green-600 text-right tabular-nums">
        {formatInt(formData.stockR)}
      </td>
     {/* Balance (placeholder, non éditable) */}
      <td className="py-3 px-4 border-b bg-gray-100 text-right tabular-nums text-gray-400 select-none">
        
      </td>

      {/* Solde (placeholder, non éditable) */}
      <td className="py-3 px-4 border-b text-right tabular-nums text-gray-400 select-none">
        
      </td>
    </tr>
  );
};

export default AddRow;